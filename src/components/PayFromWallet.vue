<!--
  PayFromWallet: "Pay from another wallet" on Receive.

  One disclosure row, like the voucher row above it: shown only while
  another wallet app on this phone can pay, with those apps' icons and
  names. It opens an info sheet of the apps as icons, the way the share
  sheet lists apps: the one picked last first and marked, then by name.
  Tapping one opens that app with the request, amount included, and the
  sheet steps away; Receive keeps waiting and announces the payment as
  always. An app that doesn't open leaves a note and Copy payment code,
  which hands back to Receive's own copy (`copy`).

  Without an amount there is nothing for another wallet to pay yet: the row
  asks Receive for the amount first (`need-amount`), and the sheet then
  follows the amount or waits for a tap (createAmountWait). Until then the
  apps are looked up for the kind of request Receive will hand over.

  Finding and opening the apps: services/walletApps.js.
-->
<template>
  <div v-show="rowVisible && apps.length">
    <button
      type="button"
      class="disclosure-row"
      data-audit="pay-from-wallet"
      :aria-label="$t('Pay from another wallet') + ', ' + appNames"
      @click="start"
    >
      <span class="pfw-stack" aria-hidden="true">
        <span v-for="app in apps.slice(0, 3)" :key="app.id" class="pfw-stack__icon">
          <img v-if="app.icon" :src="app.icon" alt="" />
          <span v-else class="pfw-initials">{{ initials(app.name) }}</span>
        </span>
      </span>
      <span class="disclosure-row-copy" aria-hidden="true">
        <strong class="disclosure-row-title">{{ $t('Pay from another wallet') }}</strong>
        <small class="disclosure-row-sub">{{ appNames }}</small>
      </span>
      <Icon icon="tabler:chevron-right" width="18" height="18" class="disclosure-row-chevron" aria-hidden="true" />
    </button>

    <q-dialog v-model="sheetOpen" position="bottom">
      <section class="info-sheet" :aria-labelledby="titleId">
        <div class="form-sheet-grabber" aria-hidden="true" />
        <div class="info-sheet-bar">
          <button type="button" class="info-sheet-done" @click="sheetOpen = false">{{ $t('Done') }}</button>
        </div>

        <header class="info-sheet-hero">
          <h2 :id="titleId">{{ $t('Pay from another wallet') }}</h2>
          <p v-if="amountLabel">{{ $t('The wallet you pick opens with {amount} to pay. BuhoGO shows it here once it arrives.', { amount: amountLabel }) }}</p>
        </header>

        <ul class="pfw-grid">
          <li v-for="app in apps" :key="app.id">
            <button
              type="button"
              class="pfw-app"
              :class="{ 'is-opening': opening === app.id }"
              :data-audit="`pay-from-wallet-${app.id}`"
              :aria-label="appLabel(app)"
              :disabled="!!opening"
              @click="pick(app)"
            >
              <span class="pfw-app__icon" aria-hidden="true">
                <img v-if="app.icon" :src="app.icon" alt="" />
                <span v-else class="pfw-initials">{{ initials(app.name) }}</span>
                <span v-if="app.lastUsed" class="pfw-app__last">{{ $t('Last used') }}</span>
              </span>
              <span class="pfw-app__name" aria-hidden="true">{{ app.name }}</span>
            </button>
          </li>
        </ul>

        <div v-if="failedName" class="pfw-note" role="status">
          <p>{{ $t("{name} didn't open.", { name: failedName }) }}</p>
          <button type="button" class="pfw-note__copy" @click="copyInstead">{{ $t('Copy payment code') }}</button>
        </div>
      </section>
    </q-dialog>
  </div>
</template>

<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { createAmountWait, findPayingApps, openPayingApp } from '../services/walletApps.js'
import { onAppVisibility } from '../utils/appVisibility.js'

const props = defineProps({
  /** What another wallet pays: lightning:… or bitcoin:…, amount included. '' until an amount is set. */
  request: { type: String, default: '' },
  /** The kind `request` will be ('lightning' or 'bitcoin'): which apps to show before there is one. */
  kind: { type: String, default: 'lightning' },
  /** The amount as Receive shows it ("₿ 21,000"), for the sheet's lead. */
  amountLabel: { type: String, default: '' },
  /** False while Receive shows its keypad: the row steps aside, a pending pick is kept. */
  rowVisible: { type: Boolean, default: true },
})
const emit = defineEmits(['need-amount', 'copy'])

// vue-i18n runs in legacy mode, where useI18n() throws: script code
// translates through the component instance instead.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const titleId = `pay-from-wallet-${proxy.$.uid}`

const apps = ref([])
const sheetOpen = ref(false)
const opening = ref('')
const failedName = ref('')
const amountWait = createAmountWait()

const appNames = computed(() => {
  const names = apps.value.map((app) => app.name)
  if (names.length > 3) {
    return t('{names} and {count} more', { names: names.slice(0, 2).join(', '), count: names.length - 2 })
  }
  try {
    return new Intl.ListFormat(proxy.$i18n.locale, { type: 'conjunction' }).format(names)
  } catch {
    return names.join(', ')
  }
})

/** What the apps are looked up for: the request, or its kind until there is one. */
const lookupRequest = computed(() => props.request || `${props.kind}:`)

// Only the latest lookup lands; a call while one runs for the same
// request shares it.
let lookup = null
function refresh() {
  const request = lookupRequest.value
  if (lookup?.request === request) return lookup.done
  const current = { request }
  current.done = findPayingApps(request)
    .then((found) => { if (lookup === current) apps.value = found || [] })
    .finally(() => { if (lookup === current) lookup = null })
  lookup = current
  return current.done
}

function start() {
  if (!props.request) {
    amountWait.ask()
    emit('need-amount')
    return
  }
  showSheet()
}

async function showSheet() {
  failedName.value = ''
  await refresh()
  sheetOpen.value = apps.value.length > 0
}

async function pick(app) {
  failedName.value = ''
  opening.value = app.id
  const opened = await openPayingApp(app)
  opening.value = ''
  if (opened) sheetOpen.value = false
  else failedName.value = app.name
}

function copyInstead() {
  sheetOpen.value = false
  emit('copy')
}

function appLabel(app) {
  const label = t('Pay with {name}', { name: app.name })
  return app.lastUsed ? `${label}, ${t('Last used')}` : label
}

/** The first letters of up to two capitalised words: "Some Wallet" gives "SW". */
function initials(name) {
  const text = String(name || '?').trim()
  const words = text.split(/\s+/).filter((word) => /^\p{Lu}/u.test(word))
  return (words.length ? words : [text]).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

watch(lookupRequest, () => {
  if (amountWait.arrived(props.request)) showSheet()
  else refresh()
})

watch(() => props.rowVisible, (visible) => {
  if (visible) amountWait.rowShown(props.request)
})

let stopVisibility = () => {}
onMounted(() => {
  refresh()
  // Back in BuhoGO, an app may have been added or removed meanwhile. The
  // visibility events can repeat, so only a change to visible looks again.
  let visible = true
  stopVisibility = onAppVisibility((now) => {
    if (now && !visible) refresh()
    visible = now
  })
})
onBeforeUnmount(() => stopVisibility())
</script>

<style scoped>
/* The row and the sheet's frame are shared (css/app.css: disclosure rows,
   info sheets); what follows is this component's own. */

/* The apps' own icons, overlapping like the rails under the code. */
.pfw-stack {
  display: flex;
  flex-shrink: 0;
}
.pfw-stack__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border-radius: 9px;
  background: var(--bg-input);
  box-shadow: 0 0 0 2px var(--bg-card);
}
.pfw-stack__icon + .pfw-stack__icon {
  margin-left: -10px;
}
.pfw-stack__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pfw-initials {
  font: 800 12px 'Manrope', sans-serif;
  color: var(--text-secondary);
}

/* The apps, the way the share sheet lists them. */
.pfw-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px 8px;
  margin: 26px 0 0;
  padding: 0;
  list-style: none;
}
.pfw-grid > li {
  display: flex;
  justify-content: center;
  min-width: 0;
}
.pfw-app {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.pfw-app:disabled {
  cursor: default;
}
.pfw-app:disabled:not(.is-opening) {
  opacity: 0.5;
}
.pfw-app:focus-visible .pfw-app__icon {
  outline: 2px solid var(--brand-accent);
  outline-offset: 3px;
}
.pfw-app:active .pfw-app__icon {
  transform: scale(0.96);
}
.pfw-app__icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 15px;
  background: var(--bg-input);
  transition: transform 0.12s ease;
}
.pfw-app__icon img {
  width: 100%;
  height: 100%;
  border-radius: 15px;
  object-fit: cover;
}
.pfw-app.is-opening .pfw-app__icon {
  opacity: 0.6;
}
.pfw-app__last {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 7px;
  border: 1px solid var(--border-card);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font: 700 10px/1.5 'Manrope', sans-serif;
  white-space: nowrap;
}
.pfw-app__name {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 12px;
  line-height: 1.3;
  text-align: center;
  color: var(--text-primary);
}

/* An app that didn't open: one line, and the way on. */
.pfw-note {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-top: 18px;
  text-align: center;
}
.pfw-note p {
  margin: 0;
  font-size: 14px;
  line-height: 1.4;
  color: var(--text-secondary);
}
.pfw-note__copy {
  min-height: 44px;
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 15px 'Manrope', sans-serif;
  cursor: pointer;
}
.pfw-note__copy:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
  border-radius: 10px;
}
</style>
