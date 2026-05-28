<script setup>
import { computed, ref, watch, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { useQuasar } from 'quasar'
import { fetchOsmDetails } from '../../services/map/osm.js'
import { bucketFor, CATEGORY_BUCKET_ICONS, SOURCE_LABEL } from '../../services/map/places.js'
import { formatDistance } from '../../utils/mapFormat.js'
import { openDirections, sharePlace } from '../../utils/mapDirections.js'
import PaymentBadges from './PaymentBadges.vue'
import FreshnessChip from './FreshnessChip.vue'

/**
 * PlaceDetail — the selected-place card shown in the bottom sheet.
 *
 * Receives a canonical place object (normalized by MapPage so pin-tap and
 * list-tap give the same shape). For BTC Map pins the rich fields (address,
 * hours, contact, precise verifiedAt) aren't in the slim API record, so we
 * lazily fetch the OSM tags when the card opens and merge them in.
 */
const props = defineProps({
  place: { type: Object, required: true },
})
defineEmits(['back'])

const $q = useQuasar()
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const locale = computed(() => proxy.$i18n.locale)

const osmDetails = ref(null)
const loadingDetails = ref(false)

// Lazily enrich from OSM when a place with an osmId opens.
watch(
  () => props.place?.id,
  async () => {
    osmDetails.value = null
    const osmId = props.place?.osmId
    if (!osmId) return
    loadingDetails.value = true
    try {
      osmDetails.value = await fetchOsmDetails(osmId)
    } finally {
      loadingDetails.value = false
    }
  },
  { immediate: true },
)

// Merge precedence: lazily-fetched OSM detail > the value already on the place.
const address = computed(() => osmDetails.value?.address || props.place.address || '')
const openingHours = computed(() => osmDetails.value?.openingHours || props.place.openingHours || '')
const phone = computed(() => osmDetails.value?.phone || props.place.phone || '')
const website = computed(() => osmDetails.value?.website || props.place.website || '')
const verifiedAt = computed(() => osmDetails.value?.verifiedAt || props.place.verifiedAt || '')

const payments = computed(() => {
  const p = props.place.payments || {}
  const o = osmDetails.value?.payments || {}
  return {
    onchain: (o.onchain ?? p.onchain) === true ? 1 : 0,
    lightning: (o.lightning ?? p.lightning) === true ? 1 : 0,
    contactless: (o.lightningContactless ?? p.lightningContactless) === true ? 1 : 0,
  }
})

const categoryIcon = computed(
  () => CATEGORY_BUCKET_ICONS[bucketFor(props.place.category)] || 'tabler:map-pin',
)
const categoryLabel = computed(() =>
  props.place.category ? props.place.category.replace(/_/g, ' ') : t('Bitcoin merchant'),
)
const distanceText = computed(() => {
  if (props.place.online) return t('Online merchant')
  return formatDistance(props.place.distance, locale.value)
})
const sourceLabels = computed(() =>
  (props.place.sources || []).map((s) => SOURCE_LABEL[s] || s),
)
const websiteHref = computed(() => {
  const w = website.value
  if (!w) return null
  return /^https?:\/\//i.test(w) ? w : `https://${w}`
})

function onDirections() {
  openDirections({ lat: props.place.lat, lon: props.place.lon, label: props.place.name })
}

async function onShare() {
  const result = await sharePlace({
    id: props.place.id,
    name: props.place.name,
    lat: props.place.lat,
    lon: props.place.lon,
  })
  if (result === 'copied') {
    $q.notify({ type: 'positive', message: t('Link copied'), timeout: 1500, position: 'top' })
  } else if (result === 'failed') {
    $q.notify({ type: 'warning', message: t("Couldn't share"), timeout: 2000, position: 'top' })
  }
}
</script>

<template>
  <div class="place-detail">
    <button class="detail-back" type="button" @click="$emit('back')">
      <Icon icon="tabler:chevron-left" width="18" height="18" />
      <span>{{ $t('Back to list') }}</span>
    </button>

    <div class="detail-head">
      <span class="detail-icon" :class="{ online: place.online }">
        <Icon :icon="place.online ? 'tabler:world' : categoryIcon" width="24" height="24" />
      </span>
      <div class="detail-headtext">
        <h2 class="detail-name">{{ place.name }}</h2>
        <div class="detail-subline">
          <span class="detail-category">{{ categoryLabel }}</span>
          <span class="detail-dot">·</span>
          <span class="detail-distance">{{ distanceText }}</span>
        </div>
      </div>
    </div>

    <div class="detail-chips">
      <PaymentBadges
        :onchain="payments.onchain"
        :lightning="payments.lightning"
        :contactless="payments.contactless"
      />
      <FreshnessChip :verified-at="verifiedAt" show-unknown />
    </div>

    <!-- Primary actions -->
    <div class="detail-actions">
      <button class="detail-action detail-action-primary" type="button" @click="onDirections">
        <Icon icon="tabler:directions" width="18" height="18" />
        <span>{{ $t('Directions') }}</span>
      </button>
      <button class="detail-action" type="button" @click="onShare">
        <Icon icon="tabler:share-2" width="18" height="18" />
        <span>{{ $t('Share') }}</span>
      </button>
      <a
        v-if="websiteHref"
        class="detail-action"
        :href="websiteHref"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon icon="tabler:world-www" width="18" height="18" />
        <span>{{ $t('Website') }}</span>
      </a>
      <a v-if="phone" class="detail-action" :href="`tel:${phone}`">
        <Icon icon="tabler:phone" width="18" height="18" />
        <span>{{ $t('Call') }}</span>
      </a>
    </div>

    <!-- Detail rows -->
    <dl class="detail-rows">
      <template v-if="address">
        <dt><Icon icon="tabler:map-pin" width="16" height="16" /></dt>
        <dd>{{ address }}</dd>
      </template>
      <template v-if="openingHours">
        <dt><Icon icon="tabler:clock-hour-4" width="16" height="16" /></dt>
        <dd class="detail-hours">{{ openingHours }}</dd>
      </template>
      <template v-if="sourceLabels.length">
        <dt><Icon icon="tabler:database" width="16" height="16" /></dt>
        <dd class="detail-sources">{{ $t('Listed on {sources}', { sources: sourceLabels.join(', ') }) }}</dd>
      </template>
    </dl>

    <div v-if="loadingDetails" class="detail-loading">
      <q-spinner-dots size="20px" :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'" />
    </div>
  </div>
</template>

<style scoped>
.place-detail {
  padding: 0 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-back {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  align-self: flex-start;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-green, #15DE72);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.detail-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  color: var(--text-secondary);
}
.detail-icon.online { color: #2F7BFF; }
.detail-headtext { min-width: 0; }
.detail-name {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 3px;
  line-height: 1.2;
}
.detail-subline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--text-muted);
}
.detail-category { text-transform: capitalize; }
.detail-distance { color: var(--color-green, #15DE72); font-weight: 600; }

.detail-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.detail-action {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.detail-action:active { transform: scale(0.97); }
.detail-action-primary {
  color: #0E1F17;
  background: var(--color-green, #15DE72);
  border-color: transparent;
}

.detail-rows {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 10px 10px;
  margin: 0;
  align-items: start;
}
.detail-rows dt {
  color: var(--text-muted);
  display: flex;
  padding-top: 1px;
}
.detail-rows dd {
  margin: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.detail-hours { white-space: pre-line; }
.detail-sources { color: var(--text-muted); font-size: 12.5px; }

.detail-loading {
  display: flex;
  justify-content: center;
  padding: 4px 0;
}
</style>
