<!--
  SparkStatusSheet: the help behind the Spark status line (#381). It says
  what happened in plain words, that the money is safe, and what to try.

  The emergency exit is mentioned only in a long, verified outage, below
  "waiting is the best choice", with the exit kit's own fee figures. When
  leaving would cost more than it brings back, the sheet says so and offers
  no way in. The exit itself lives in one place, the backup area under
  Security; the row here only leads there.
-->
<template>
  <q-dialog :model-value="modelValue" position="bottom" @update:model-value="$emit('update:modelValue', $event)">
    <section class="spark-sheet" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <header class="spark-sheet__head">
        <h2 :id="titleId">{{ title }}</h2>
        <button type="button" class="spark-sheet__done" @click="close">{{ $t('Done') }}</button>
      </header>

      <template v-if="level === LEVEL.NO_INTERNET">
        <p class="spark-sheet__lead">{{ $t("This phone can't reach the internet right now. Your money is safe.") }}</p>
        <h3 class="spark-sheet__label">{{ $t('Things to check') }}</h3>
        <ul class="spark-facts">
          <li v-for="fact in offlineFacts" :key="fact.title">
            <Icon icon="tabler:info-circle" width="18" height="18" aria-hidden="true" />
            <span><strong>{{ fact.title }}</strong>{{ fact.text }}</span>
          </li>
        </ul>
      </template>

      <template v-else>
        <p class="spark-sheet__lead">{{ lead }}</p>
        <ul class="spark-facts">
          <li>
            <Icon icon="tabler:shield-check" width="18" height="18" aria-hidden="true" />
            <span>
              <strong>{{ $t('Your money is safe') }}</strong>
              {{ long ? $t('It stays yours. Waiting is still the best choice while Spark may come back.') : $t('It stays yours while Spark is away. Nothing is lost by waiting.') }}
            </span>
          </li>
          <li>
            <Icon icon="tabler:player-pause" width="18" height="18" aria-hidden="true" />
            <span>
              <strong>{{ $t('Payments are paused') }}</strong>
              {{ long ? $t('BuhoGO keeps trying each time you open it.') : $t('Sending and receiving work again as soon as Spark answers. BuhoGO keeps trying.') }}
            </span>
          </li>
          <li v-if="statusFact">
            <Icon icon="tabler:info-circle" width="18" height="18" aria-hidden="true" />
            <span><strong>{{ statusFact.title }}</strong>{{ statusFact.text }}</span>
          </li>
        </ul>
        <p v-if="lastAnswer" class="spark-sheet__note">{{ lastAnswer }}</p>

        <template v-if="long">
          <h3 class="spark-sheet__label">{{ $t('If Spark stays away') }}</h3>
          <template v-if="exit.worth">
            <p class="spark-sheet__note">{{ $t('You can move your money to a Bitcoin address without Spark. Starting is free and can be cancelled before anything is sent.') }}</p>
            <ul class="spark-facts">
              <li>
                <Icon icon="tabler:clock" width="18" height="18" aria-hidden="true" />
                <span><strong>{{ $t('Takes about 2 weeks') }}</strong>{{ $t('Bitcoin unlocks it step by step. Keep BuhoGO installed.') }}</span>
              </li>
              <li v-if="exit.figures">
                <Icon icon="tabler:coins" width="18" height="18" aria-hidden="true" />
                <span>
                  <strong>{{ $t('About {amount} sats in network fees', { amount: exit.figures.fee }) }}</strong>
                  {{ $t("At the last check you'd get about {arrives} of your {balance} sats.", { arrives: exit.figures.arrives, balance: exit.figures.balance }) }}
                </span>
              </li>
            </ul>
            <button type="button" class="spark-sheet__row" data-audit="spark-status-exit" @click="openExitKit">
              <span class="spark-sheet__row-copy">
                <strong>{{ $t('Emergency exit') }}</strong>
                <small>{{ $t('Opens your exit kit in Security') }}</small>
              </span>
              <Icon icon="tabler:chevron-right" width="16" height="16" aria-hidden="true" />
            </button>
          </template>
          <p v-else class="spark-sheet__note">{{ $t('At the last check, leaving would cost more in network fees than it brings back, so waiting is the better choice. The emergency exit stays in Security, next to your backup.') }}</p>
        </template>
      </template>

      <template v-if="!long">
        <p v-if="retryNote" class="spark-sheet__note spark-sheet__retry-note" role="status">{{ retryNote }}</p>
        <button type="button" class="form-sheet-primary spark-sheet__retry" :disabled="checking" :aria-busy="checking" @click="tryAgain">
          <q-spinner v-if="checking" size="18px" />
          <template v-else>{{ $t('Try again') }}</template>
        </button>
      </template>
    </section>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { LEVEL, SPARK_STATUS_OK } from '../../utils/sparkReachability.js'
import { checkSparkNow } from '../../services/sparkReachabilityCheck.js'
import { useExitKitStore } from '../../stores/exitKit'
import { useWalletStore } from '../../stores/wallet'
import { formatSats, formatTime, relativeDay } from '../../composables/useExitFormat.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** A snapshot from useSparkReachability(). */
  state: { type: Object, required: true },
  walletId: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

// vue-i18n runs in legacy mode, so useI18n() throws; use the instance's $t.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const router = useRouter()
const kits = useExitKitStore()
const wallets = useWalletStore()

const titleId = `spark-status-${proxy.$.uid}`
const checking = ref(false)
const retryNote = ref('')

const level = computed(() => props.state.level)
const long = computed(() => level.value === LEVEL.LONG_OUTAGE)
const locale = () => proxy.$i18n.locale

function when(at) {
  const day = relativeDay(at, t, locale())
  return day === t('today') ? `${day} ${formatTime(at, locale())}` : day
}

const title = computed(() => {
  if (level.value === LEVEL.NO_INTERNET) return t('No internet connection')
  if (long.value && props.state.since) return t('Spark unreachable since {day}', { day: relativeDay(props.state.since, t, locale()) })
  return t("Spark can't be reached")
})

const lead = computed(() => (long.value && props.state.since
  ? t("Your internet works, but Spark hasn't answered since {when}.", { when: when(props.state.since) })
  : t("Your internet works, but Spark isn't answering. This is usually temporary.")))

const offlineFacts = computed(() => [
  { title: t('VPN'), text: t('If a VPN is on, check that it is connected, or turn it off for a moment.') },
  { title: t('Wi-Fi or mobile data'), text: t('Make sure one of them is on and has signal.') },
  { title: t('Public Wi-Fi'), text: t('Some networks need you to sign in first in the browser.') },
])

/** Spark's own status page: it confirms, and "all fine" points at this network. */
const statusFact = computed(() => {
  const status = props.state.status
  if (status === SPARK_STATUS_OK) {
    return { title: t('Spark reports no problem'), text: t('So this network may be blocking Spark. Try another Wi-Fi or mobile data.') }
  }
  if (['degraded', 'partial', 'major'].includes(status)) {
    return { title: t('Spark reports an outage'), text: t("Spark's own status page confirms a problem on their side.") }
  }
  return null
})

const lastAnswer = computed(() => {
  const at = props.state.lastAnsweredAt
  return at && !long.value ? t('Last answer from Spark {when}.', { when: when(at) }) : ''
})

/**
 * The exit kit's figures from its last check. Worth it only when more
 * comes back than the fees take (the SDK's own rule); figures stay out
 * while balances are hidden.
 */
const exit = computed(() => {
  const kit = kits.kitFor(props.walletId)
  const fee = kit?.feeSat || 0
  const recoverable = kit?.recoverableSat || 0
  const quoted = !!kit?.checkedAt && fee > 0
  if (!quoted) return { worth: true, figures: null }
  const worth = recoverable > fee && (kit.arrivesSat || 0) > 0
  const figures = wallets.balanceHidden ? null : {
    fee: formatSats(fee, locale()),
    arrives: formatSats(kit.arrivesSat, locale()),
    balance: formatSats(recoverable + (kit.notWorthSat || 0), locale()),
  }
  return { worth, figures }
})

watch(() => props.modelValue, (isOpen) => { if (isOpen) retryNote.value = '' })

function close() {
  emit('update:modelValue', false)
}

async function tryAgain() {
  if (checking.value) return
  checking.value = true
  retryNote.value = ''
  try {
    await checkSparkNow()
  } finally {
    checking.value = false
  }
  // Still here after a fresh check: say so, so the tap visibly did something.
  if (props.modelValue && props.state.level !== LEVEL.NONE) retryNote.value = t('Still no answer. BuhoGO keeps trying.')
}

function openExitKit() {
  close()
  router.push({ path: '/security', query: { open: 'exit-kit' } })
}
</script>

<style scoped>
/* Quasar only makes a dialog's direct child <div> tappable; this root is a <section>. */
.spark-sheet {
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  max-height: min(88dvh, calc(100dvh - var(--safe-top, 0px) - 8px));
  overflow-y: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border-top: 1px solid var(--border-card);
  padding: 0 20px max(20px, var(--safe-bottom, 0px));
  font-family: 'Manrope', sans-serif;
}
.spark-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
}
.spark-sheet__head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.25;
}
.spark-sheet__done {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 16px 'Manrope', sans-serif;
  cursor: pointer;
}
.spark-sheet__lead,
.spark-sheet__note {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.spark-sheet__note {
  font-size: 14px;
}
.spark-sheet__label {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.spark-facts {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border-card);
  border-radius: 14px;
}
.spark-facts li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text-secondary);
}
.spark-facts li + li {
  border-top: 1px solid var(--border-card);
}
.spark-facts li svg {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--text-secondary);
}
.spark-facts strong {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.spark-sheet__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 14px;
  border: 1px solid var(--border-card);
  border-radius: 14px;
  background: none;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.spark-sheet__row svg {
  flex-shrink: 0;
  color: var(--text-muted, var(--text-secondary));
}
.spark-sheet__row-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.spark-sheet__row-copy strong {
  font-size: 15px;
  font-weight: 600;
}
.spark-sheet__row-copy small {
  font-size: 13px;
  color: var(--text-secondary);
}
.spark-sheet__row:focus-visible,
.spark-sheet__done:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
  border-radius: 10px;
}
.spark-sheet__retry {
  width: 100%;
  margin-top: 4px;
}
.spark-sheet__retry-note {
  text-align: center;
}
</style>
