<script setup>
import { computed, getCurrentInstance } from 'vue'
import { Icon } from '@iconify/vue'
import { openDirections } from '../../utils/mapDirections.js'
import { openInAppBrowser } from '../../utils/inAppBrowser.js'

/**
 * MeetupDetail — the selected Einundzwanzig meetup card shown in the bottom
 * sheet (the meetup counterpart to PlaceDetail). A meetup is a community
 * gathering, not a shop, so there's no payment/Lightning UI — just where it is,
 * how to get there, and the community's contact links (Telegram / website / X /
 * Nostr) plus a deep link to the Einundzwanzig portal. Web links open in the
 * in-app browser so we never bounce the user out of the Capacitor shell.
 */
const props = defineProps({
  meetup: { type: Object, required: true },
})
defineEmits(['back'])

const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)

const logoSrc = (import.meta.env.BASE_URL || '/') + 'Einundzwanzig/einundzwanzig-square.svg'

const place = computed(() =>
  [props.meetup.city, props.meetup.state, props.meetup.country].filter(Boolean).join(' · '),
)

const hasCoords = computed(
  () => Number.isFinite(Number(props.meetup.lat)) && Number.isFinite(Number(props.meetup.lon)),
)

function ensureScheme(value) {
  if (!value) return ''
  const v = String(value).trim()
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

function stripHandle(value) {
  if (!value) return ''
  let v = String(value).trim().replace(/^@+/, '')
  if (/^https?:\/\//i.test(v)) {
    try {
      const parts = new URL(v).pathname.split('/').filter(Boolean)
      if (parts.length) return parts[parts.length - 1]
    } catch {
      // fall through to the raw value
    }
  }
  return v
}

const telegramHref = computed(() => {
  const raw = props.meetup.telegram
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  const h = stripHandle(raw)
  return h ? `https://t.me/${h}` : ''
})
const websiteHref = computed(() => ensureScheme(props.meetup.website))
const twitterHref = computed(() => {
  const h = stripHandle(props.meetup.twitter)
  return h ? `https://twitter.com/${h}` : ''
})
const nostrHref = computed(() => {
  const n = props.meetup.nostr
  return n ? `https://njump.me/${stripHandle(n)}` : ''
})
const portalHref = computed(() => ensureScheme(props.meetup.portalLink))

const links = computed(() => {
  const out = []
  if (telegramHref.value) out.push({ key: 'telegram', label: 'Telegram', icon: 'tabler:brand-telegram', url: telegramHref.value })
  if (websiteHref.value) out.push({ key: 'website', label: t('Website'), icon: 'tabler:world-www', url: websiteHref.value })
  if (twitterHref.value) out.push({ key: 'twitter', label: 'X', icon: 'tabler:brand-x', url: twitterHref.value })
  if (nostrHref.value) out.push({ key: 'nostr', label: 'Nostr', icon: 'tabler:bolt', url: nostrHref.value })
  return out
})

function onDirections() {
  openDirections({ lat: Number(props.meetup.lat), lon: Number(props.meetup.lon), label: props.meetup.name })
}
function openLink(url) {
  openInAppBrowser(url)
}
</script>

<template>
  <div class="meetup-detail">
    <div class="detail-inner">
      <div class="detail-topbar">
        <button class="detail-back" type="button" @click="$emit('back')">
          <Icon icon="tabler:chevron-left" width="18" height="18" />
          <span>{{ $t('Back to list') }}</span>
        </button>
      </div>

      <!-- Identity -->
      <div class="detail-head">
        <span class="detail-logo">
          <img :src="logoSrc" alt="Einundzwanzig" width="34" height="34" />
        </span>
        <div class="detail-headtext">
          <h2 class="detail-name">{{ meetup.name }}</h2>
          <div v-if="place" class="detail-subline">{{ place }}</div>
          <div class="detail-kind">{{ $t('Bitcoin meetup') }} · Einundzwanzig</div>
        </div>
      </div>

      <!-- Actions -->
      <div class="detail-actions">
        <button
          v-if="hasCoords"
          class="detail-action detail-action-primary"
          type="button"
          @click="onDirections"
        >
          <Icon icon="tabler:directions" width="20" height="20" />
          <span>{{ $t('Directions') }}</span>
        </button>
        <button
          v-if="portalHref"
          class="detail-action"
          type="button"
          @click="openLink(portalHref)"
        >
          <Icon icon="tabler:external-link" width="20" height="20" />
          <span>{{ $t('View meetup') }}</span>
        </button>
      </div>

      <!-- Contact + social (open in-app, never external) -->
      <div v-if="links.length" class="detail-contact">
        <button
          v-for="l in links"
          :key="l.key"
          class="contact-chip"
          type="button"
          @click="openLink(l.url)"
        >
          <Icon :icon="l.icon" width="16" height="16" />
          <span>{{ l.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.meetup-detail {
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
.detail-topbar { display: flex; align-items: center; }
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

.detail-head { display: flex; align-items: flex-start; gap: 12px; }
.detail-logo {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #fff;
  border: 1px solid var(--border-card);
}
.detail-logo img { display: block; }
.detail-headtext { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.detail-name {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.2;
}
.detail-subline {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--text-muted);
}
.detail-kind {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #F7931A;
}

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
</style>
