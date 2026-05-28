<script setup>
import { computed, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'

/**
 * Payment method badges — Lightning / on-chain / contactless.
 *
 * Tristate per method: a badge only renders when the method is *confirmed*
 * accepted. We never imply "yes" from missing data (research: absence of a
 * tag ≠ acceptance). Icon + label, never color alone (color-blind + dark-mode
 * safe). `compact` drops the labels for tight list rows.
 */
const props = defineProps({
  // 1 = confirmed, 0/undefined = unknown/not-confirmed.
  onchain: { type: [Number, Boolean], default: 0 },
  lightning: { type: [Number, Boolean], default: 0 },
  contactless: { type: [Number, Boolean], default: 0 },
  compact: { type: Boolean, default: false },
})

// vue-i18n runs in legacy mode (src/boot/i18n.js), so useI18n() throws.
// Reach $t through the component proxy — the app's established pattern.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)

const badges = computed(() => {
  const out = []
  if (Number(props.lightning) === 1) {
    out.push({ key: 'lightning', icon: 'tabler:bolt', label: t('Lightning') })
  }
  if (Number(props.contactless) === 1) {
    out.push({ key: 'contactless', icon: 'tabler:wifi', label: t('Contactless') })
  }
  if (Number(props.onchain) === 1) {
    out.push({ key: 'onchain', icon: 'tabler:link', label: t('On-chain') })
  }
  return out
})
</script>

<template>
  <div v-if="badges.length" class="pay-badges" :class="{ compact }">
    <span
      v-for="b in badges"
      :key="b.key"
      class="pay-badge"
      :class="`pay-badge-${b.key}`"
    >
      <Icon :icon="b.icon" :width="compact ? 13 : 14" :height="compact ? 13 : 14" />
      <span v-if="!compact" class="pay-badge-label">{{ b.label }}</span>
    </span>
  </div>
</template>

<style scoped>
.pay-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pay-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.2;
  border: 1px solid transparent;
}
.pay-badges.compact .pay-badge {
  padding: 4px;
  border-radius: 8px;
}

/* Lightning — amber. On-chain — bitcoin orange-brown. Contactless — blue.
   Color reinforces, never carries meaning alone (icon + label do that). */
.pay-badge-lightning {
  background: rgba(255, 184, 0, 0.16);
  color: #C98A00;
  border-color: rgba(255, 184, 0, 0.28);
}
.pay-badge-contactless {
  background: rgba(47, 123, 255, 0.14);
  color: #2F7BFF;
  border-color: rgba(47, 123, 255, 0.26);
}
.pay-badge-onchain {
  background: rgba(247, 147, 26, 0.14);
  color: #C2710E;
  border-color: rgba(247, 147, 26, 0.26);
}

body.body--dark .pay-badge-lightning { color: #FFC93C; }
body.body--dark .pay-badge-contactless { color: #6FA4FF; }
body.body--dark .pay-badge-onchain { color: #F7931A; }
</style>
