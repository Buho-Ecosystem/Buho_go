<template>
  <div class="last-tx-section" :class="{ 'last-tx-dark': $q.dark.isActive }">
    <!-- Keep confirmation separate from the busy details: assistive technology
         can announce settled funds while their descriptive fields are fetched. -->
    <span class="last-tx-sr-only" role="status" aria-live="polite" aria-atomic="true">
      <span v-if="isReceipt" :key="arrivalKey">{{ $t('Bitcoin received') }}</span>
    </span>

    <div v-if="phase === 'initial'" class="last-tx-card-skeleton" aria-hidden="true">
      <span class="last-tx-skeleton-circle" />
      <span class="last-tx-card-skeleton-text">
        <span class="last-tx-skeleton-line last-tx-skeleton-title" />
        <span class="last-tx-skeleton-line last-tx-skeleton-subtitle" />
      </span>
      <span class="last-tx-card-skeleton-amount">
        <span class="last-tx-skeleton-line last-tx-skeleton-number" />
        <span class="last-tx-skeleton-line last-tx-skeleton-fiat" />
      </span>
    </div>

    <div v-else-if="phase !== 'empty'" class="last-tx-card-surface">
      <button
        type="button"
        class="last-tx-card"
        :class="{ 'last-tx-card-receipt': isReceipt, 'last-tx-card-reconciling': phase === 'receipt' }"
        :aria-label="$t('Open transaction history')"
        @click="$emit('open-history')"
      >
        <span :key="`avatar:${contentKey}`" class="last-tx-avatar-wrap" :class="{ 'last-tx-avatar-receipt': isReceipt, 'last-tx-content-arrival': animateContent }">
          <span v-if="isReceipt" class="last-tx-receive-icon" aria-hidden="true">
            <Icon icon="tabler:arrow-down-left" width="20" height="20" />
          </span>
          <template v-else>
            <ContactAvatar v-if="contact" class="last-tx-avatar" :entry="contact" />
            <ContactAvatar
              v-else-if="avatarPicture"
              class="last-tx-avatar"
              :picture="avatarPicture"
              :entry="{ address: avatarAddress }"
              :name="heading.kind === 'message' ? '' : heading.text"
            />
            <ContactAvatar v-else class="last-tx-avatar" :entry="{ address: avatarAddress }" />
            <span v-if="badge" class="last-tx-type-badge" :class="badge.cls" aria-hidden="true">
              <Icon :icon="badge.icon" width="9" height="9" />
            </span>
          </template>
          <!-- A traveling highlight describes work on the details, rather than
               another settlement. It disappears immediately when work ends. -->
          <span v-if="phase === 'receipt'" class="last-tx-detail-orbit" aria-hidden="true" />
        </span>

        <span :key="`details:${contentKey}`" class="last-tx-info" :class="{ 'last-tx-content-arrival': animateContent }">
          <span class="last-tx-title" :class="{ 'last-tx-title-message': !isReceipt && heading.kind === 'message' }">
            <template v-if="isReceipt">{{ $t('Bitcoin received') }}</template>
            <template v-else-if="heading.kind === 'message'">&#8220;{{ heading.text }}&#8221;</template>
            <template v-else>{{ heading.text }}</template>
          </span>
          <span class="last-tx-time" :aria-busy="phase === 'receipt' ? 'true' : undefined">
            <span v-if="phase === 'receipt'" class="last-tx-detail-placeholder" aria-hidden="true" />
            <!-- Retry is a sibling button below; reserve this exact line. -->
            <span v-else-if="phase === 'unavailable'" aria-hidden="true">&nbsp;</span>
            <template v-else>{{ time }}</template>
          </span>
        </span>

        <span class="last-tx-amount-wrap">
          <span class="last-tx-amount">
            <HiddenAmount>
              <span v-if="amount" :key="amount" class="last-tx-amount-value">{{ amount }}</span>
              <span v-else class="last-tx-unknown-amount" aria-hidden="true">—</span>
            </HiddenAmount>
          </span>
          <span class="last-tx-fiat">
            <HiddenAmount><span v-if="fiat">{{ fiat }}</span><span v-else aria-hidden="true">&nbsp;</span></HiddenAmount>
          </span>
        </span>
      </button>
      <button
        v-if="phase === 'unavailable'"
        type="button"
        class="last-tx-retry"
        :title="$t('Retry')"
        :aria-label="$t('Retry')"
        @click="$emit('retry')"
      >
        <Icon icon="tabler:refresh" width="12" height="12" aria-hidden="true" />
        <span>{{ $t('Retry') }}</span>
      </button>
    </div>

    <button type="button" class="history-link" data-audit="history-link" @click="$emit('open-history')">
      <Icon icon="tabler:list" width="16" height="16" aria-hidden="true" />
      <span>{{ $t('History') }}</span>
    </button>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import ContactAvatar from './AddressBook/ContactAvatar.vue';
import HiddenAmount from './HiddenAmount.vue';

export default {
  name: 'LatestTransactionCard',
  components: { Icon, ContactAvatar, HiddenAmount },
  emits: ['open-history', 'retry'],
  props: {
    phase: { type: String, default: 'empty', validator: value => ['initial', 'ready', 'receipt', 'unavailable', 'empty'].includes(value) },
    transactionKey: { type: String, default: '' },
    receiptKey: { type: String, default: '' },
    // Only a new, distinct receipt changes this key. Reconciliation and
    // duplicate signals may enrich the content without replaying its arrival.
    arrivalKey: { type: [String, Number], default: '' },
    contact: { type: Object, default: null },
    avatarPicture: { type: String, default: '' },
    avatarAddress: { type: String, default: '' },
    badge: { type: Object, default: null },
    heading: { type: Object, default: () => ({ text: '', kind: 'generic' }) },
    time: { type: String, default: '' },
    amount: { type: String, default: '' },
    fiat: { type: String, default: '' },
  },
  computed: {
    isReceipt() { return this.phase === 'receipt' || this.phase === 'unavailable'; },
    contentKey() { return `${this.transactionKey || this.receiptKey}:${this.arrivalKey}:${this.phase}`; },
    animateContent() { return !!this.arrivalKey && this.phase !== 'unavailable'; },
  },
};
</script>

<style scoped>
.last-tx-section {
  --last-tx-background: #fff;
  --last-tx-border: #e2e8f0;
  --last-tx-title: #0f172a;
  --last-tx-muted: #64748b;
  --last-tx-message: #334155;
  --last-tx-icon-background: #f1f5f9;
  --last-tx-icon: #475569;
  --last-tx-highlight: #94a3b8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 1.25rem;
  margin-bottom: 1.5rem;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.last-tx-dark {
  --last-tx-background: var(--bg-secondary, #121b2b);
  --last-tx-border: var(--border-card, #293548);
  --last-tx-title: #f1f5f9;
  --last-tx-muted: #94a3b8;
  --last-tx-message: #cbd5e1;
  --last-tx-icon-background: rgba(255, 255, 255, .06);
  --last-tx-icon: #cbd5e1;
  --last-tx-highlight: #cbd5e1;
}
.last-tx-card-surface,
.last-tx-card-skeleton { width: 100%; max-width: 440px; min-width: 0; }
.last-tx-card-surface { position: relative; }
.last-tx-card,
.last-tx-card-skeleton {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 64px;
  box-sizing: border-box;
  padding: 12px 14px;
  border: 1px solid var(--last-tx-border);
  border-radius: 14px;
  background: var(--last-tx-background);
}
.last-tx-card {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 120ms ease, background 150ms ease;
}
.last-tx-card:active { transform: scale(.99); }
.last-tx-card:focus-visible,
.last-tx-retry:focus-visible,
.history-link:focus-visible { outline: 2px solid var(--last-tx-icon); outline-offset: 3px; }
.last-tx-avatar-wrap { position: relative; flex: 0 0 36px; width: 36px; height: 36px; display: inline-flex; }
.last-tx-avatar { flex: 0 0 auto; width: 36px; height: 36px; font-size: 14px; }
.last-tx-receive-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--last-tx-icon-background);
  color: var(--last-tx-icon);
}
.last-tx-detail-orbit {
  position: absolute;
  inset: -3px;
  border: 1px solid transparent;
  border-top-color: var(--last-tx-highlight);
  border-right-color: var(--last-tx-border);
  border-radius: 50%;
  opacity: .75;
  animation: last-tx-details 1400ms linear infinite;
}
.last-tx-type-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 0 0 2px var(--last-tx-background);
}
.tx-badge-in { background: #10b981; }
.tx-badge-out { background: #ef4444; }
.tx-badge-pos { background: #3b82f6; }
.tx-badge-aux { background: #64748b; }
.tx-badge-zap { background: #662482; }
.tx-badge-zap :deep(svg) { width: 12px; height: 12px; }
.last-tx-info { display: flex; flex: 1 1 auto; min-width: 0; flex-direction: column; gap: 2px; overflow: hidden; }
.last-tx-title,
.last-tx-time,
.last-tx-fiat,
.last-tx-amount { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.last-tx-title { color: var(--last-tx-title); font-size: 14px; font-weight: 600; line-height: 1.2; }
.last-tx-title-message { font-weight: 400; color: var(--last-tx-message); }
.last-tx-time,
.last-tx-fiat { color: var(--last-tx-muted); font-size: 12px; font-weight: 400; line-height: 1.2; min-height: 14.4px; }
.last-tx-time { display: block; }
.last-tx-detail-placeholder { display: inline-block; width: 70px; max-width: 75%; height: 5px; vertical-align: middle; border-radius: 4px; background: var(--last-tx-border); }
.last-tx-amount-wrap { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0; max-width: 45%; }
.last-tx-amount { max-width: 100%; color: var(--last-tx-title); font-size: 14px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
.last-tx-amount-value { display: inline-block; animation: last-tx-amount-in 180ms ease-out both; }
.last-tx-content-arrival { animation: last-tx-content-in 220ms cubic-bezier(.2,.7,.2,1) both; }
.last-tx-retry {
  position: absolute;
  left: 59px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 3px 4px;
  border: 0;
  border-radius: 4px;
  color: var(--last-tx-muted);
  background: var(--last-tx-background);
  font: 400 11px/1.2 'Manrope', sans-serif;
  cursor: pointer;
}
.last-tx-retry:hover { color: var(--last-tx-title); }
.history-link { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; border: 0; background: none; color: var(--last-tx-icon); font: 500 14px 'Manrope', sans-serif; cursor: pointer; transition: opacity 120ms ease; -webkit-tap-highlight-color: transparent; }
.history-link:active { opacity: .6; }
.last-tx-card-skeleton-text { display: flex; flex: 1 1 auto; min-width: 0; flex-direction: column; gap: 8px; }
.last-tx-card-skeleton-amount { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; gap: 8px; }
.last-tx-skeleton-circle,
.last-tx-skeleton-line { display: block; background: var(--last-tx-border); animation: last-tx-skeleton 1600ms ease-in-out infinite; }
.last-tx-skeleton-circle { flex: 0 0 36px; height: 36px; border-radius: 50%; }
.last-tx-skeleton-line { height: 8px; border-radius: 4px; }
.last-tx-skeleton-title { width: 65%; }
.last-tx-skeleton-subtitle { width: 40%; height: 6px; }
.last-tx-skeleton-number { width: 72px; }
.last-tx-skeleton-fiat { width: 48px; height: 6px; }
.last-tx-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@keyframes last-tx-details { to { transform: rotate(360deg); } }
@keyframes last-tx-content-in { from { opacity: .25; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes last-tx-amount-in { from { opacity: .6; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
@keyframes last-tx-skeleton { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .last-tx-card:active { transform: none; }
  .last-tx-detail-orbit { border-color: var(--last-tx-border); border-top-color: var(--last-tx-highlight); }
}
</style>
