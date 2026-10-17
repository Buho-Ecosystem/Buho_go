<!--
  SparkStatusSheet: the help behind the Spark status line (#381).

  Built like a "content unavailable" view: an icon, a title, one sentence,
  one action. What a person may want to know sits in a grouped list, one
  short line per fact (your money, payments, Spark's status), the way
  Settings shows status. Small print goes under the list as a footnote.

  The emergency exit appears only in a long, verified outage, as its own
  section with one row and its cost. When leaving would cost more than it
  brings back, the row says so and leads nowhere. The exit itself lives in
  one place, the backup area under Security; the row only leads there.
-->
<template>
  <q-dialog :model-value="modelValue" position="bottom" @update:model-value="$emit('update:modelValue', $event)">
    <section class="spark-sheet" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <div class="spark-sheet__bar">
        <button type="button" class="spark-sheet__done" @click="close">{{ $t('Done') }}</button>
      </div>

      <header class="spark-sheet__hero">
        <span class="spark-sheet__hero-icon" aria-hidden="true">
          <Icon :icon="level === LEVEL.NO_INTERNET ? 'tabler:wifi-off' : 'tabler:cloud-off'" width="26" height="26" />
        </span>
        <h2 :id="titleId">{{ title }}</h2>
        <p>{{ lead }}</p>
      </header>

      <ul class="spark-list">
        <li v-for="row in rows" :key="row.label" class="spark-row">
          <span class="spark-row__tile" :class="`is-${row.tone}`" aria-hidden="true">
            <Icon :icon="row.icon" width="17" height="17" />
          </span>
          <span class="spark-row__label">{{ row.label }}</span>
          <span class="spark-row__value" :class="`is-${row.tone}`">{{ row.value }}</span>
        </li>
      </ul>
      <p v-if="footnote" class="spark-sheet__foot">{{ footnote }}</p>

      <template v-if="long">
        <h3 class="spark-sheet__section">{{ $t('If Spark stays away') }}</h3>
        <div class="spark-list">
          <button v-if="exit.worth" type="button" class="spark-row spark-row--link" data-audit="spark-status-exit" @click="openExitKit">
            <span class="spark-row__tile" aria-hidden="true"><Icon icon="tabler:fire-extinguisher" width="17" height="17" /></span>
            <span class="spark-row__label">
              {{ $t('Emergency exit') }}
              <small>{{ exit.cost }}</small>
            </span>
            <Icon icon="tabler:chevron-right" width="16" height="16" class="spark-row__chevron" aria-hidden="true" />
          </button>
          <div v-else class="spark-row">
            <span class="spark-row__tile" aria-hidden="true"><Icon icon="tabler:fire-extinguisher" width="17" height="17" /></span>
            <span class="spark-row__label">{{ $t('Emergency exit') }}</span>
            <span class="spark-row__value">{{ $t('Not worth it now') }}</span>
          </div>
        </div>
        <p v-if="!exit.worth" class="spark-sheet__foot">{{ $t('Leaving now would cost more in fees than it brings back.') }}</p>
      </template>

      <p v-if="retryNote" class="spark-sheet__foot spark-sheet__retry-note" role="status">{{ retryNote }}</p>
      <button type="button" class="form-sheet-primary spark-sheet__retry" :disabled="checking" :aria-busy="checking" @click="tryAgain">
        <q-spinner v-if="checking" size="18px" />
        <template v-else>{{ $t('Try again') }}</template>
      </button>
    </section>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { LEVEL } from '../../utils/sparkReachability.js'
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

// vue-i18n runs in legacy mode: $t arrives after setup, so translate only
// inside computeds and handlers, never during setup.
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

/** Spark's own status as one word, or nothing when it could not be read. */
const STATUS_LABEL = {
  operational: { key: 'No problem', tone: 'neutral' },
  degraded: { key: 'Partial outage', tone: 'warn' },
  partial: { key: 'Partial outage', tone: 'warn' },
  major: { key: 'Major outage', tone: 'warn' },
}

const title = computed(() => {
  if (level.value === LEVEL.NO_INTERNET) return t('No internet connection')
  if (long.value && props.state.since) return t('Spark unreachable since {day}', { day: relativeDay(props.state.since, t, locale()) })
  return t("Spark can't be reached")
})

const lead = computed(() => {
  if (level.value === LEVEL.NO_INTERNET) return t('Check Wi-Fi, mobile data or your VPN.')
  if (long.value) return t('Waiting is the best choice.')
  if (props.state.blockedHere) return t('Try another Wi-Fi or mobile data.')
  return t('This is usually temporary.')
})

const rows = computed(() => {
  const money = { icon: 'tabler:shield-check', tone: 'good', label: t('Your money'), value: t('Safe') }
  if (level.value === LEVEL.NO_INTERNET) {
    return [money, { icon: 'tabler:world-off', tone: 'warn', label: t('This phone'), value: t('Offline') }]
  }
  const list = [money, { icon: 'tabler:player-pause', tone: 'warn', label: t('Payments'), value: t('Paused') }]
  const status = STATUS_LABEL[props.state.status]
  if (status) list.push({ icon: 'tabler:activity', tone: status.tone, label: t('Spark status'), value: t(status.key) })
  return list
})

const footnote = computed(() => {
  if (level.value !== LEVEL.UNREACHABLE) return ''
  if (props.state.blockedHere) return t('Spark is fine, so this network may be blocking it.')
  const at = props.state.lastAnsweredAt
  if (!at) return ''
  const day = relativeDay(at, t, locale())
  const when = day === t('today') ? `${day} ${formatTime(at, locale())}` : day
  return t('Last answer from Spark {when}.', { when })
})

/**
 * The exit kit's figures from its last check. Worth it only when more
 * comes back than the fees take (the SDK's own rule). Without a quote, or
 * while balances are hidden, the row names the duration only.
 */
const exit = computed(() => {
  const kit = kits.kitFor(props.walletId)
  const fee = kit?.feeSat || 0
  const quoted = !!kit?.checkedAt && fee > 0
  if (!quoted) return { worth: true, cost: t('About 2 weeks') }
  const worth = (kit.recoverableSat || 0) > fee && (kit.arrivesSat || 0) > 0
  const cost = wallets.balanceHidden
    ? t('About 2 weeks')
    : t('2 weeks · about {amount} sats in fees', { amount: formatSats(fee, locale()) })
  return { worth, cost }
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
  max-height: min(90dvh, calc(100dvh - var(--safe-top, 0px) - 8px));
  overflow-y: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border-top: 1px solid var(--border-card);
  padding: 0 20px max(20px, var(--safe-bottom, 0px));
  font-family: 'Manrope', sans-serif;
  /* Status tones: green says safe, amber says waiting; nothing reads as an alarm. */
  --spark-good: var(--brand-accent-text);
  --spark-good-tile: var(--brand-accent-soft);
  --spark-warn: #8A5A00;
  --spark-warn-tile: rgba(196, 140, 20, 0.16);
  --spark-tile: var(--bg-input);
}
/* A short screen scrolls the sheet; nothing in it may be squeezed instead. */
.spark-sheet > * {
  flex-shrink: 0;
}
.body--dark .spark-sheet {
  --spark-warn: #F5C451;
  --spark-warn-tile: rgba(245, 196, 81, 0.14);
}

.spark-sheet__bar {
  display: flex;
  justify-content: flex-end;
  min-height: 36px;
  margin-top: -6px;
}
.spark-sheet__done {
  min-height: 44px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 16px 'Manrope', sans-serif;
  cursor: pointer;
}

.spark-sheet__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  text-align: center;
}
.spark-sheet__hero-icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: var(--spark-tile);
  color: var(--text-secondary);
}
.spark-sheet__hero h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.25;
  text-wrap: balance;
}
.spark-sheet__hero p {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  color: var(--text-secondary);
  text-wrap: balance;
}

.spark-list {
  margin: 22px 0 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border-card);
  border-radius: 14px;
  overflow: hidden;
}
.spark-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 54px;
  padding: 9px 14px;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  font: inherit;
}
.spark-row + .spark-row {
  border-top: 1px solid var(--border-card);
}
.spark-row--link {
  cursor: pointer;
}
.spark-row__tile {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--spark-tile);
  color: var(--text-secondary);
}
.spark-row__tile.is-good {
  background: var(--spark-good-tile);
  color: var(--spark-good);
}
.spark-row__tile.is-warn {
  background: var(--spark-warn-tile);
  color: var(--spark-warn);
}
.spark-row__label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 15px;
  font-weight: 600;
}
.spark-row__label small {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.spark-row__value {
  flex-shrink: 0;
  max-width: 50%;
  text-align: right;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}
.spark-row__value.is-good {
  color: var(--spark-good);
}
.spark-row__value.is-warn {
  color: var(--spark-warn);
}
.spark-row__chevron {
  flex-shrink: 0;
  color: var(--text-muted, var(--text-secondary));
}

.spark-sheet__foot {
  margin: 8px 4px 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted, var(--text-secondary));
}
.spark-sheet__section {
  margin: 22px 4px 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted, var(--text-secondary));
}
.spark-sheet__section + .spark-list {
  margin-top: 8px;
}
.spark-sheet__retry {
  width: 100%;
  margin-top: 22px;
}
.spark-sheet__retry-note {
  text-align: center;
}
.spark-sheet__done:focus-visible,
.spark-row--link:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
  border-radius: 10px;
}
</style>
