<template>
  <Transition name="exit-banner">
    <div v-if="visible" class="exit-banner" :class="$q.dark.isActive ? 'exit-banner-dark' : 'exit-banner-light'" role="status">
      <div class="exit-banner-head">
        <span class="exit-banner-icon" aria-hidden="true"><Icon icon="tabler:alert-triangle" width="20" height="20" /></span>
        <div class="exit-banner-text">
          <strong>{{ $t('Spark is not responding') }}</strong>
          <span>{{ $t('Your money is still yours. You can wait, or move it to plain Bitcoin on your own.') }}</span>
        </div>
        <button type="button" class="exit-banner-dismiss" :aria-label="$t('Dismiss')" @click="$emit('dismiss')">
          <Icon icon="tabler:x" width="14" height="14" />
        </button>
      </div>
      <div class="exit-banner-actions">
        <button type="button" class="exit-banner-open" @click="$emit('open')">{{ $t('Emergency exit') }}</button>
        <span v-if="lastContact" class="exit-banner-meta">{{ $t('Last contact {when}', { when: lastContact }) }}</span>
      </div>
    </div>
  </Transition>
</template>

<script>
import { Icon } from '@iconify/vue';

/**
 * The one place the emergency exit is promoted, and only after a sustained
 * Spark outage. Calm by design: a status, one way in, one way to dismiss
 * for a day. Never shown on a happy path.
 */
export default {
  name: 'ExitBanner',
  components: { Icon },
  props: {
    visible: { type: Boolean, default: false },
    lastContact: { type: String, default: '' },
  },
  emits: ['open', 'dismiss'],
};
</script>

<style scoped>
.exit-banner { display: flex; flex-direction: column; gap: 12px; margin: 4px 16px 8px; padding: 14px 14px 14px 16px; border-radius: 16px; }
.exit-banner-head { display: flex; gap: 10px; align-items: flex-start; }
.exit-banner-light { background: #1A1A1C; color: #FAF7EF; }
.exit-banner-dark { background: #23231F; color: #FAF7EF; border: 1px solid rgba(255, 255, 255, 0.08); }
.exit-banner-icon { display: flex; flex-shrink: 0; margin-top: 2px; color: #F5C451; }
.exit-banner-text { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.exit-banner-text strong { font-size: 15px; font-weight: 700; line-height: 1.3; }
.exit-banner-text span { font-size: 13px; line-height: 1.45; color: rgba(250, 247, 239, 0.82); }
.exit-banner-meta { font-size: 12px; color: rgba(250, 247, 239, 0.62); }
.exit-banner-actions { display: flex; align-items: center; gap: 12px; }
.exit-banner-dismiss { width: 32px; height: 32px; border: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.1); color: inherit; display: grid; place-items: center; padding: 0; cursor: pointer; }
.exit-banner-open { min-height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: #FAF7EF; color: #1A1A1C; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
.exit-banner-enter-active, .exit-banner-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.exit-banner-enter-from, .exit-banner-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
