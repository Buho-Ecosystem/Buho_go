<script setup>
import { computed, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { bucketFor, CATEGORY_BUCKET_ICONS } from '../../services/map/places.js'
import { formatDistance } from '../../utils/mapFormat.js'
import PaymentBadges from './PaymentBadges.vue'
import FreshnessChip from './FreshnessChip.vue'

/**
 * A single nearby-place row in the bottom-sheet list. Name + category icon,
 * distance (or an "Online" tag for synthetic BTCPay merchants), payment
 * badges, and a freshness chip. Tapping selects the place (parent flies the
 * map + opens detail).
 */
const props = defineProps({
  place: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
defineEmits(['select'])

// vue-i18n legacy mode (src/boot/i18n.js): reach $t + locale via the proxy.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const locale = computed(() => proxy.$i18n.locale)

const categoryIcon = computed(
  () => CATEGORY_BUCKET_ICONS[bucketFor(props.place.category)] || 'tabler:map-pin',
)

const categoryLabel = computed(() => {
  const c = props.place.category
  return c ? c.replace(/_/g, ' ') : t('Bitcoin merchant')
})

// Online (BTCPay centroid) merchants have a meaningless physical distance, so
// we label them "Online" instead of a misleading "1,234 km".
const distanceText = computed(() => {
  if (props.place.online) return t('Online')
  return formatDistance(props.place.distance, locale.value)
})
</script>

<template>
  <button
    type="button"
    class="place-row"
    :class="{ selected }"
    @click="$emit('select', place)"
  >
    <span class="place-row-icon" :class="{ online: place.online }">
      <Icon :icon="place.online ? 'tabler:world' : categoryIcon" width="20" height="20" />
    </span>

    <span class="place-row-body">
      <span class="place-row-top">
        <span class="place-row-name">{{ place.name }}</span>
        <span class="place-row-distance">{{ distanceText }}</span>
      </span>
      <span class="place-row-category">{{ categoryLabel }}</span>
      <span class="place-row-meta">
        <PaymentBadges
          :onchain="place.payments?.onchain ? 1 : 0"
          :lightning="place.payments?.lightning ? 1 : 0"
          :contactless="place.payments?.lightningContactless ? 1 : 0"
          compact
        />
        <FreshnessChip :verified-at="place.verifiedAt || ''" />
      </span>
    </span>
  </button>
</template>

<style scoped>
.place-row {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  border-radius: 12px;
  transition: background-color 140ms ease;
}
.place-row:active { background: var(--brand-accent-soft, rgba(21, 222, 114, 0.06)); }
.place-row.selected { background: var(--brand-accent-soft, rgba(21, 222, 114, 0.1)); }

.place-row-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  color: var(--text-secondary);
}
.place-row-icon.online { color: #2F7BFF; }

.place-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.place-row-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.place-row-name {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.place-row-distance {
  flex-shrink: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-green, #15DE72);
}
.place-row-category {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: capitalize;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.place-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
</style>
