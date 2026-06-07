<script setup>
import { computed, ref, watch, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { useQuasar } from 'quasar'
import { fetchOsmDetails } from '../../services/map/osm.js'
import { bucketFor, CATEGORY_BUCKET_ICONS, SOURCE_LABEL } from '../../services/map/places.js'
import { formatDistance } from '../../utils/mapFormat.js'
import { openDirections, sharePlace } from '../../utils/mapDirections.js'
import { openInAppBrowser } from '../../utils/inAppBrowser.js'
import { useMapFavoritesStore } from '../../stores/mapFavorites.js'
import { useMapUnitsStore } from '../../stores/mapUnits.js'
import PaymentBadges from './PaymentBadges.vue'
import FreshnessChip from './FreshnessChip.vue'

/**
 * PlaceDetail — the selected-place card shown in the bottom sheet.
 *
 * Receives a canonical place object (normalized by MapPage). For BTC Map pins
 * the rich fields (address, hours, contact, Lightning Address, precise
 * verifiedAt) aren't in the slim API record, so we lazily fetch the OSM tags
 * when the card opens and merge them in.
 *
 * Layout is sectioned to stay scannable, not overloaded: header (name + fav),
 * Ways-to-pay (badges + Lightning Address with copy/pay), primary actions,
 * info rows, and contact/social. Web links open in the in-app browser so we
 * never bounce the user out of the Capacitor shell; "Pay" routes into our own
 * send flow.
 */
const props = defineProps({
  place: { type: Object, required: true },
})
const emit = defineEmits(['back', 'pay'])

const $q = useQuasar()
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const locale = computed(() => proxy.$i18n.locale)

const favorites = useMapFavoritesStore()
const isFavorite = computed(() => favorites.isFavorite(props.place.id))
const units = useMapUnitsStore()

const osmDetails = ref(null)
const loadingDetails = ref(false)

watch(
  () => props.place?.id,
  async (id) => {
    osmDetails.value = null
    const osmId = props.place?.osmId
    if (!osmId) return
    loadingDetails.value = true
    try {
      const details = await fetchOsmDetails(osmId)
      // Tapping quickly between pins can resolve an older fetch last; ignore it
      // unless this is still the selected place.
      if (props.place?.id === id) osmDetails.value = details
    } finally {
      if (props.place?.id === id) loadingDetails.value = false
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
const lightningAddress = computed(
  () => osmDetails.value?.lightningAddress || props.place.lightningAddress || '',
)

// Only offer "Pay" for forms our send flow can actually handle: an email-style
// Lightning Address or an LNURL. Bare node IDs get copy-only.
const isPayableLightning = computed(() => {
  const a = lightningAddress.value
  return /@/.test(a) || /^lnurl/i.test(a) || /^lightning:/i.test(a)
})

const payments = computed(() => {
  const p = props.place.payments || {}
  const o = osmDetails.value?.payments || {}
  return {
    onchain: (o.onchain ?? p.onchain) === true ? 1 : 0,
    lightning: (o.lightning ?? p.lightning) === true ? 1 : 0,
    contactless: (o.lightningContactless ?? p.lightningContactless) === true ? 1 : 0,
  }
})

const SOCIAL_ICONS = {
  telegram: 'tabler:brand-telegram',
  twitter: 'tabler:brand-twitter',
  mastodon: 'tabler:brand-mastodon',
  instagram: 'tabler:brand-instagram',
  facebook: 'tabler:brand-facebook',
}
const socials = computed(() => {
  const c = osmDetails.value?.contacts || props.place.contacts || {}
  return Object.entries(c)
    .filter(([, url]) => !!url)
    .map(([platform, url]) => ({ platform, url, icon: SOCIAL_ICONS[platform] || 'tabler:link' }))
})

const categoryIcon = computed(
  () => CATEGORY_BUCKET_ICONS[bucketFor(props.place.category)] || 'tabler:map-pin',
)
const categoryLabel = computed(() =>
  props.place.category ? props.place.category.replace(/_/g, ' ') : t('Bitcoin merchant'),
)
const distanceText = computed(() => {
  if (props.place.online) return t('Online merchant')
  return formatDistance(props.place.distance, locale.value, units.distanceUnit)
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

const lnCopied = ref(false)
async function copyLightning() {
  try {
    await navigator.clipboard.writeText(lightningAddress.value)
    lnCopied.value = true
    setTimeout(() => { lnCopied.value = false }, 1400)
  } catch {
    $q.notify({ type: 'warning', message: t("Couldn't copy"), timeout: 1500, position: 'top' })
  }
}

function payMerchant() {
  // Hand the Lightning Address to MapPage, which routes into BuhoGO's own
  // send flow (no web, no external app).
  emit('pay', lightningAddress.value)
}

function openLink(url) {
  openInAppBrowser(url)
}

function onToggleFavorite() {
  favorites.toggle(props.place.id)
  $q.notify({
    type: isFavorite.value ? 'positive' : 'info',
    message: isFavorite.value ? t('Saved') : t('Removed from saved'),
    timeout: 1400,
    position: 'top',
  })
}
</script>

<template>
  <div class="place-detail">
    <!-- Content is capped to a readable column so the card stays well-aligned
         on wide screens (tablet/desktop) and goes full-width on phones. -->
    <div class="detail-inner">
      <!-- Back -->
      <div class="detail-topbar">
        <button class="detail-back" type="button" @click="$emit('back')">
          <Icon icon="tabler:chevron-left" width="18" height="18" />
          <span>{{ $t('Back to list') }}</span>
        </button>
      </div>

      <!-- Identity + key facts -->
      <div class="detail-head">
        <span class="detail-icon" :class="{ online: place.online }">
          <Icon :icon="place.online ? 'tabler:world' : categoryIcon" width="24" height="24" />
        </span>
        <div class="detail-headtext">
          <h2 class="detail-name">{{ place.name }}</h2>
          <div class="detail-subline">
            <span class="detail-category">{{ categoryLabel }}</span>
            <template v-if="distanceText">
              <span class="detail-dot">·</span>
              <span class="detail-distance">{{ distanceText }}</span>
            </template>
          </div>
          <FreshnessChip class="detail-fresh" :verified-at="verifiedAt" show-unknown />
        </div>
      </div>

      <!-- Accepted payments (key fact for a Bitcoin map) -->
      <PaymentBadges
        v-if="payments.onchain || payments.lightning || payments.contactless"
        :onchain="payments.onchain"
        :lightning="payments.lightning"
        :contactless="payments.contactless"
      />

      <!-- Lightning address: copy / pay this place directly -->
      <div v-if="lightningAddress" class="ln-row">
        <span class="ln-icon"><Icon icon="tabler:bolt" width="16" height="16" /></span>
        <span class="ln-value">{{ lightningAddress }}</span>
        <button class="ln-btn" type="button" :aria-label="$t('Copy')" @click="copyLightning">
          <Icon :icon="lnCopied ? 'tabler:check' : 'tabler:copy'" width="16" height="16" />
        </button>
        <button
          v-if="isPayableLightning"
          class="ln-btn ln-btn-pay"
          type="button"
          @click="payMerchant"
        >
          {{ $t('Pay') }}
        </button>
      </div>

      <!-- Actions: Directions (primary) / Save / Share -->
      <div class="detail-actions">
        <button class="detail-action detail-action-primary" type="button" @click="onDirections">
          <Icon icon="tabler:directions" width="20" height="20" />
          <span>{{ $t('Directions') }}</span>
        </button>
        <button
          class="detail-action detail-action-fav"
          :class="{ on: isFavorite }"
          type="button"
          :aria-pressed="isFavorite"
          :aria-label="isFavorite ? $t('Remove from saved') : $t('Save place')"
          @click="onToggleFavorite"
        >
          <Icon :icon="isFavorite ? 'tabler:star-filled' : 'tabler:star'" width="20" height="20" />
          <span>{{ isFavorite ? $t('Saved') : $t('Save') }}</span>
        </button>
        <button class="detail-action" type="button" @click="onShare">
          <Icon icon="tabler:share-2" width="20" height="20" />
          <span>{{ $t('Share') }}</span>
        </button>
      </div>

      <!-- Address & hours -->
      <dl v-if="address || openingHours" class="detail-rows">
        <template v-if="address">
          <dt><Icon icon="tabler:map-pin" width="16" height="16" /></dt>
          <dd>{{ address }}</dd>
        </template>
        <template v-if="openingHours">
          <dt><Icon icon="tabler:clock-hour-4" width="16" height="16" /></dt>
          <dd class="detail-hours">{{ openingHours }}</dd>
        </template>
      </dl>

      <!-- Contact + social (web links open in-app, never external) -->
      <div v-if="websiteHref || phone || socials.length" class="detail-contact">
        <button v-if="websiteHref" class="contact-chip" type="button" @click="openLink(websiteHref)">
          <Icon icon="tabler:world-www" width="16" height="16" />
          <span>{{ $t('Website') }}</span>
        </button>
        <a v-if="phone" class="contact-chip" :href="`tel:${phone}`">
          <Icon icon="tabler:phone" width="16" height="16" />
          <span>{{ $t('Call') }}</span>
        </a>
        <button
          v-for="s in socials"
          :key="s.platform"
          class="contact-chip contact-chip-icon"
          type="button"
          :aria-label="s.platform"
          @click="openLink(s.url)"
        >
          <Icon :icon="s.icon" width="16" height="16" />
        </button>
      </div>

      <!-- Provenance -->
      <div v-if="sourceLabels.length" class="detail-sources">
        {{ $t('Listed on {sources}', { sources: sourceLabels.join(', ') }) }}
      </div>

      <div v-if="loadingDetails" class="detail-loading">
        <q-spinner-dots size="20px" :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.place-detail {
  padding: 0 16px 8px;
}
.detail-inner {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-topbar {
  display: flex;
  align-items: center;
}
.detail-back {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--map-accent);
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
.detail-headtext { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.detail-name {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
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
.detail-distance { color: var(--map-accent); font-weight: 600; }
.detail-fresh { margin-top: 1px; }

/* Lightning Address row */
.ln-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
}
.ln-icon { color: #C98A00; display: flex; flex-shrink: 0; }
body.body--dark .ln-icon { color: #FFC93C; }
.ln-value {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ln-btn {
  all: unset;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  min-width: 30px;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  -webkit-tap-highlight-color: transparent;
}
.ln-btn:active { transform: scale(0.95); }
.ln-btn-pay {
  background: var(--map-cta-bg);
  color: var(--map-cta-fg);
  border-color: transparent;
  padding: 0 14px;
}

/* Primary actions — equal icon-over-label buttons (maps-app pattern) */
.detail-actions { display: flex; gap: 8px; }
.detail-action {
  all: unset;
  box-sizing: border-box;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 11px 8px;
  border-radius: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  color: var(--text-primary);
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.detail-action:active { transform: scale(0.97); }
.detail-action-primary {
  color: var(--map-cta-fg);
  background: var(--map-cta-bg);
  border-color: transparent;
}
.detail-action-fav.on {
  color: #FFB400;
  background: rgba(255, 180, 0, 0.1);
  border-color: rgba(255, 180, 0, 0.35);
}

/* Info rows */
.detail-rows {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 10px;
  margin: 0;
  align-items: start;
}
.detail-rows dt { color: var(--text-muted); display: flex; padding-top: 1px; }
.detail-rows dd {
  margin: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.detail-hours { white-space: pre-line; }

/* Contact + social */
.detail-contact { display: flex; flex-wrap: wrap; gap: 8px; }
.contact-chip {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.contact-chip:active { transform: scale(0.96); }
.contact-chip-icon { padding: 0; width: 36px; justify-content: center; }

.detail-sources {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  color: var(--text-muted);
}

.detail-loading { display: flex; justify-content: center; padding: 4px 0; }
</style>
