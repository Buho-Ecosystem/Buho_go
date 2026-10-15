/**
 * Owner-only goal manifests and sending. No shared room or shared wallet.
 * Each saved template names one person and gets one stable rumor id. The
 * complete manifest reaches encrypted storage before any request is sent.
 */
import { createRumor } from 'nostr-core'
import {
  allocateRequest,
  requestSourceKey
} from '../../utils/requestAllocation.js'
import { buildRequestTemplate, parseRumor, MESSAGE_TYPE } from './protocol.js'
import { DM_ERROR, DmError, isSignerWait } from './errors.js'

const HEX = /^[0-9a-f]{64}$/
const ID = /^[a-zA-Z0-9_-]{1,80}$/
const invalid = () =>
  new DmError(DM_ERROR.INVALID_ARGUMENT, 'invalid request goal')

/** Strict hydration: persisted templates must reproduce their own request ids. */
export function normalizeRequestGoal(raw, owner) {
  try {
    if (
      !raw ||
      raw.owner !== owner ||
      !HEX.test(owner) ||
      typeof raw.id !== 'string' ||
      !ID.test(raw.id) ||
      !Array.isArray(raw.shares)
    )
      return null
    if (raw.source && !requestSourceKey(raw.source)) return null
    const allocation = allocateRequest({
      people: raw.shares,
      method: 'amounts',
      totalSats: raw.totalSats,
      repayment: true,
      includeSelf: true
    })
    if (
      allocation.error ||
      allocation.ownSats !== raw.ownSats ||
      !Number.isSafeInteger(raw.createdAt) ||
      raw.createdAt < 0
    )
      return null
    if (
      !['equal', 'amounts'].includes(raw.method) ||
      typeof raw.note !== 'string'
    )
      return null
    const shares = raw.shares.map((share) => {
      if (
        !HEX.test(share.pubkey) ||
        share.pubkey === owner ||
        !HEX.test(share.requestId) ||
        typeof share.name !== 'string' ||
        share.name.length > 200
      )
        throw invalid()
      const validateAttempt = (attempt) => {
        const message = parseRumor(createRumor(attempt.template, owner), {
          me: owner
        })
        if (
          !message?.outgoing ||
          message.type !== MESSAGE_TYPE.REQUEST ||
          message.id !== attempt.requestId ||
          message.partner !== share.pubkey ||
          message.request.amountSats !== share.amountSats ||
          message.createdAt < raw.createdAt ||
          (message.request.note || '') !== raw.note
        )
          throw invalid()
        return {
          requestId: attempt.requestId,
          template: {
            kind: attempt.template.kind,
            created_at: attempt.template.created_at,
            tags: attempt.template.tags.map((tag) => [...tag]),
            content: attempt.template.content
          }
        }
      }
      const attempt = validateAttempt(share)
      const previousRequests = (share.previousRequests || []).map(
        validateAttempt
      )
      return {
        pubkey: share.pubkey,
        name: share.name,
        amountSats: share.amountSats,
        requestId: share.requestId,
        template: attempt.template,
        previousRequests,
        errorCode: Object.values(DM_ERROR).includes(share.errorCode)
          ? share.errorCode
          : null
      }
    })
    const source =
      raw.source &&
      typeof raw.source.walletId === 'string' &&
      typeof raw.source.transactionId === 'string' &&
      raw.source.walletId.length <= 200 &&
      raw.source.transactionId.length <= 500
        ? {
            walletId: raw.source.walletId,
            transactionId: raw.source.transactionId
          }
        : null
    return {
      id: raw.id,
      owner,
      createdAt: raw.createdAt,
      method: raw.method,
      note: raw.note,
      totalSats: raw.totalSats,
      ownSats: raw.ownSats,
      source,
      shares,
      sendErrorCode: Object.values(DM_ERROR).includes(raw.sendErrorCode)
        ? raw.sendErrorCode
        : null
    }
  } catch {
    return null
  }
}

export function createRequestGoalService({
  me,
  store,
  requests,
  send,
  retry,
  assertUsable,
  nowSeconds,
  randomId = () => crypto.randomUUID()
}) {
  const active = new Map()
  const creating = new Map()
  const renewing = new Map()
  async function durable() {
    assertUsable()
    // A goal must survive a restart: refuse it while this identity cannot be saved.
    if (store.canPersist?.() === false || (await store.flush()) === false)
      throw new DmError(
        DM_ERROR.STORAGE_UNAVAILABLE,
        'request storage unavailable'
      )
    assertUsable()
  }
  async function create({
    id,
    people,
    method = 'equal',
    totalSats,
    repayment = false,
    includeSelf = true,
    note,
    source = null
  }) {
    assertUsable()
    if (
      typeof id !== 'string' ||
      !ID.test(id) ||
      (source && !requestSourceKey(source)) ||
      people?.some((person) => !HEX.test(person.pubkey) || person.pubkey === me)
    )
      throw invalid()
    const existing =
      store.requestGoal(id) ||
      (requestSourceKey(source) && store.requestGoalForSource(source))
    if (existing) {
      await deliver(existing.id)
      return existing.id
    }
    const allocation = allocateRequest({
      people,
      method,
      totalSats,
      repayment,
      includeSelf
    })
    if (allocation.error) throw invalid()
    // Check every distinct amount before creating any obligation. The same
    // address must accept them all; switching identity/address aborts the send.
    let address
    for (const amount of new Set(
      allocation.shares.map((share) => share.amountSats)
    )) {
      const checked = await requests.checkOwnAddress(amount)
      assertUsable()
      if (address && checked !== address)
        throw new DmError(DM_ERROR.NO_IDENTITY, 'receiving address changed')
      address = checked
    }
    const createdAt = nowSeconds()
    const shares = allocation.shares.map((share) => {
      const template = buildRequestTemplate({
        recipient: share.pubkey,
        amountSats: share.amountSats,
        lud16: address,
        note,
        now: () => createdAt
      })
      // Requests to the same person in the same second remain distinct.
      template.tags.push(['nonce', randomId()])
      return {
        ...share,
        name: String(
          people.find((person) => person.pubkey === share.pubkey)?.name || ''
        ).slice(0, 200),
        template,
        requestId: createRumor(template, me).id,
        errorCode: null
      }
    })
    const cleanNote =
      parseRumor(createRumor(shares[0].template, me), { me }).request.note || ''
    if (
      !store.addRequestGoal({
        id,
        owner: me,
        createdAt,
        method,
        note: cleanNote,
        totalSats: allocation.totalSats,
        ownSats: allocation.ownSats,
        source,
        shares
      })
    ) {
      const winner = store.requestGoal(id) || store.requestGoalForSource(source)
      if (!winner) throw invalid()
      await deliver(winner.id)
      return winner.id
    }
    await durable()
    await deliver(id)
    return id
  }
  function deliver(id, requestId = null) {
    if (active.has(id)) return active.get(id)
    const task = (async () => {
      assertUsable()
      const goal = store.requestGoal(id)
      if (!goal) throw invalid()
      store.setRequestGoalSendError(id, null)
      await durable()
      for (const share of goal.shares) {
        if (requestId && share.requestId !== requestId) continue
        assertUsable()
        const message = store
          .thread(share.pubkey)
          .messages.find((message) => message.id === share.requestId)
        if (message?.delivery === 'sent') continue
        try {
          if (message) await retry(share.requestId)
          else await send(share.pubkey, share.template)
          assertUsable()
          store.setRequestGoalError(id, share.requestId, null)
        } catch (error) {
          assertUsable()
          store.setRequestGoalError(
            id,
            share.requestId,
            DmError.is(error) ? error.code : DM_ERROR.RELAY_UNAVAILABLE
          )
          if (isSignerWait(error)) break
        }
        await durable()
      }
      await durable()
    })().finally(() => active.delete(id))
    active.set(id, task)
    return task
  }
  function createOnce(options) {
    if (creating.has(options?.id)) return creating.get(options.id)
    const task = create(options)
      .catch((error) => {
        if (store.scope === me && store.requestGoal(options?.id))
          store.setRequestGoalSendError(
            options.id,
            DmError.is(error) ? error.code : DM_ERROR.RELAY_UNAVAILABLE
          )
        throw error
      })
      .finally(() => creating.delete(options?.id))
    creating.set(options?.id, task)
    return task
  }
  async function renewShare(partner, requestId) {
    assertUsable()
    const goal = store.requestGoalFor(requestId)
    const share = goal?.shares.find(
      (share) =>
        share.pubkey === partner && requestIdsOf(share).includes(requestId)
    )
    if (!share) throw invalid()
    if (share.requestId !== requestId) {
      await deliver(goal.id, share.requestId)
      return share.requestId
    }
    if (
      store.settlement(requestId) ||
      store.requestStatus(requestId, nowSeconds()) !== 'expired'
    )
      throw invalid()
    const address = await requests.checkOwnAddress(share.amountSats)
    assertUsable()
    const template = buildRequestTemplate({
      recipient: partner,
      amountSats: share.amountSats,
      note: goal.note || undefined,
      lud16: address,
      replaces: requestId,
      now: () => Math.max(nowSeconds(), share.template.created_at + 1)
    })
    template.tags.push(['nonce', randomId()])
    const nextId = createRumor(template, me).id
    store.replaceRequestGoalShare(goal.id, requestId, {
      template,
      requestId: nextId
    })
    await durable()
    await deliver(goal.id, nextId)
    return nextId
  }
  function renew(partner, requestId) {
    const key = `${partner}:${requestId}`
    if (renewing.has(key)) return renewing.get(key)
    const task = renewShare(partner, requestId).finally(() =>
      renewing.delete(key)
    )
    renewing.set(key, task)
    return task
  }
  return { create: createOnce, deliver, renew }
}

export const requestIdsOf = (share) => [
  share.requestId,
  ...(share.previousRequests || []).map((attempt) => attempt.requestId)
]

/**
 * A request sent from inside a chat, shaped as a one-person goal, so the
 * Requests page lists and derives it like every other request.
 */
export function chatRequestGoal(message) {
  const { amountSats, note } = message.request
  return {
    id: message.id,
    createdAt: message.createdAt,
    note: note || '',
    totalSats: amountSats,
    ownSats: 0,
    shares: [
      { pubkey: message.partner, name: '', amountSats, requestId: message.id }
    ]
  }
}

/** One compact view model; only verified settlements contribute to progress. */
export function requestGoalProgress(
  goal,
  { messageFor, stateFor, settlementFor }
) {
  const shares = goal.shares.map((share) => {
    const message = messageFor(share)
    const settlement = requestIdsOf(share)
      .map(settlementFor)
      .find((settlement) => settlement?.verified)
    const status = stateFor(share.requestId)
    const paid = settlement?.verified === true
    const state = paid
      ? 'paid'
      : status === 'paid'
        ? 'checking'
        : !message ||
            message.delivery === 'failed' ||
            (share.errorCode && message.delivery !== 'sent')
          ? 'failed'
          : message.delivery !== 'sent'
            ? 'sending'
            : status || 'pending'
    return {
      ...share,
      state,
      canRetry: state === 'failed',
      hasMessage: Boolean(message)
    }
  })
  const paid = shares.filter((share) => share.state === 'paid')
  return {
    ...goal,
    shares,
    paidCount: paid.length,
    receivedSats: paid.reduce((sum, share) => sum + share.amountSats, 0),
    collectSats: goal.totalSats - goal.ownSats,
    complete: paid.length === shares.length
  }
}
