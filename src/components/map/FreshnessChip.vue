<script setup>
import { computed, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { freshness } from '../../utils/mapFormat.js'

/**
 * Freshness chip — "Verified 3 months ago" with fresh/aging/stale tiers.
 *
 * The single biggest trust differentiator for a Bitcoin map: stale pins
 * (shops that quietly stopped accepting) are the category's #1 problem.
 * We surface the verification recency explicitly instead of hiding it.
 *
 * fresh  (<6mo)  → green check
 * aging  (6–12mo)→ neutral clock
 * stale  (>12mo) → muted, "Not recently verified"
 * unknown        → hidden by default unless `showUnknown`
 */
const props = defineProps({
  verifiedAt: { type: String, default: '' },
  showUnknown: { type: Boolean, default: false },
})

// vue-i18n runs in legacy mode (src/boot/i18n.js); reach $t + locale through
// the component proxy. Both are reactive through the proxy, so the computeds
// re-run on a language switch.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const locale = computed(() => proxy.$i18n.locale)

const model = computed(() => freshness(props.verifiedAt, locale.value))

const visible = computed(
  () => model.value.tier !== 'unknown' || props.showUnknown,
)

const label = computed(() => {
  const { tier, relative } = model.value
  if (tier === 'unknown') return t('Not verified')
  if (tier === 'stale') return t('Not recently verified')
  // "Verified {when}" → "Verified 3 months ago" / "Verifiziert vor 3 Monaten"
  return t('Verified {when}', { when: relative })
})

const icon = computed(() => {
  switch (model.value.tier) {
    case 'fresh':
      return 'tabler:rosette-discount-check'
    case 'aging':
      return 'tabler:clock'
    default:
      return 'tabler:help-circle'
  }
})
</script>

<template>
  <span v-if="visible" class="freshness-chip" :class="`freshness-${model.tier}`">
    <Icon :icon="icon" width="13" height="13" />
    <span class="freshness-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.freshness-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}
.freshness-fresh { color: var(--color-green, #15DE72); }
.freshness-aging { color: var(--text-secondary, #6B7280); }
.freshness-stale { color: var(--text-muted, #928D83); }
.freshness-unknown { color: var(--text-muted, #928D83); }
</style>
