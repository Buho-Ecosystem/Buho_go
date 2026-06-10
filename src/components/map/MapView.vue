<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadEinundzwanzigPinImage } from '../../services/map/meetupPin.js'

/**
 * MapView — the MapLibre GL surface for the Bitcoin map.
 *
 * Responsibilities are deliberately narrow: render the basemap (style chosen by
 * the user), cluster + draw pins from a GeoJSON FeatureCollection, own the
 * user-location marker and the locate/zoom controls, and report viewport
 * changes + pin taps upward. All list/sheet/detail UX lives in the parent page.
 *
 * The map instance is kept in a plain closure variable (never a ref) so Vue's
 * reactivity proxy never wraps MapLibre's internals.
 */

const SOURCE_ID = 'places'
// Einundzwanzig meetups ride their own source/layer above the merchant pins so
// they keep their distinct logo pin and never fold into a merchant cluster.
const MEETUP_SOURCE_ID = 'meetups'
const MEETUP_IMAGE_ID = 'pin-meetup'
const PIN_COLOR = '#f7931a' // Bitcoin orange — same in both themes for brand consistency.
const PITCH_3D = 60 // Camera tilt for the 3D view (MapLibre's default max pitch).

const props = defineProps({
  // GeoJSON FeatureCollection from the store.
  data: { type: Object, default: () => ({ type: 'FeatureCollection', features: [] }) },
  // Einundzwanzig meetups FeatureCollection (empty when the layer is toggled off).
  meetups: { type: Object, default: () => ({ type: 'FeatureCollection', features: [] }) },
  // Resolved basemap tile-style URL (chosen in the map's style picker).
  styleUrl: { type: String, required: true },
  // 3D view: when true, tilt the camera to a 60° pitch.
  tilted: { type: Boolean, default: false },
  // Pixels to lift the bottom-right controls so they ride above the sheet.
  bottomInset: { type: Number, default: 24 },
  // When false (during a sheet drag), the controls follow the inset instantly
  // instead of easing, so they track the finger 1:1.
  controlsAnimated: { type: Boolean, default: true },
  // Currently selected place id (for the highlighted pin).
  selectedId: { type: String, default: '' },
  // User position { lat, lon } | null — drives the blue dot.
  userLocation: { type: Object, default: null },
})

const emit = defineEmits(['ready', 'select', 'select-meetup', 'move', 'recenter-request', 'user-pan'])

const mapContainer = ref(null)

let map = null
let userMarker = null
let viewportTimer = null
const reduceMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}

// ── Pin images ──────────────────────────────────────────────────────────────
// Each pin is an orange disc with a white category glyph drawn into it, so a
// place reads as food / shop / ATM / lodging at a glance instead of a generic
// ₿. Pins are canvas-rendered (not DOM markers) to keep MapLibre's symbol-layer
// clustering and performance with hundreds of places.
//
// The glyphs are the exact Tabler icons the list rows and detail card use
// (CATEGORY_BUCKET_ICONS in services/map/places.js); their raw 24×24 path data
// lives here so canvas can stroke it via Path2D with no runtime icon fetch.
// Keep this map and CATEGORY_BUCKET_ICONS in sync — same buckets, same icons.
const ICON_VIEWBOX = 24
const PIN_SIZE = 64
const PIN_SIZE_SELECTED = 84
const PIN_GLYPHS = {
  food: ['M19 3v12h-5c-.023-3.681.184-7.406 5-12m0 12v6h-1v-3M8 4v17M5 4v3a3 3 0 1 0 6 0V4'],
  retail: [
    'M6.331 8H17.67a2 2 0 0 1 1.977 2.304l-1.255 8.152A3 3 0 0 1 15.426 21H8.574a3 3 0 0 1-2.965-2.544l-1.255-8.152A2 2 0 0 1 6.331 8',
    'M9 11V6a3 3 0 0 1 6 0v5',
  ],
  lodging: ['M5 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0m17 8v-3H2m0-6v9m10-3h10v-2a3 3 0 0 0-3-3h-7z'],
  services: [
    'M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm5-2V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-4 5v.01',
    'M3 13a20 20 0 0 0 18 0',
  ],
  atm: [
    'M7 15H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3',
    'M7 10a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z',
    'M12 14a2 2 0 1 0 4 0a2 2 0 0 0-4 0',
  ],
  fuel: [
    'M14 11h1a2 2 0 0 1 2 2v3a1.5 1.5 0 0 0 3 0V9l-3-3M4 20V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14M3 20h12',
    'M18 7v1a1 1 0 0 0 1 1h1M4 11h10',
  ],
  leisure: [
    'M12 5h3.5a5 5 0 0 1 0 10H10l-4.015 4.227a2.3 2.3 0 0 1-3.923-2.035l1.634-8.173A5 5 0 0 1 8.6 5z',
    'm14 15l4.07 4.284a2.3 2.3 0 0 0 3.925-2.023l-1.6-8.232M8 9v2m-1-1h2m5 0h2',
  ],
  online: [
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0m.6-3h16.8M3.6 15h16.8',
    'M11.5 3a17 17 0 0 0 0 18m1-18a17 17 0 0 1 0 18',
  ],
  other: [
    'M9 11a3 3 0 1 0 6 0a3 3 0 0 0-6 0',
    'M17.657 16.657L13.414 20.9a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0',
  ],
}

// White Tabler glyph, centred in the disc and scaled to ~55% of the pin. Tabler
// icons are stroked outlines (round caps/joins), so we stroke rather than fill.
// A heavier line weight (vs Tabler's stock 2) keeps the glyph readable once the
// pin renders at the layer's small icon-size.
function drawGlyph(ctx, size, paths) {
  const glyph = size * 0.55
  const scale = glyph / ICON_VIEWBOX
  ctx.save()
  ctx.translate((size - glyph) / 2, (size - glyph) / 2)
  ctx.scale(scale, scale)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const d of paths) ctx.stroke(new Path2D(d))
  ctx.restore()
}

function makePinImage(size, ring, paths) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const r = size / 2 - (ring ? 8 : 6)
  ctx.shadowColor = 'rgba(0,0,0,0.22)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  ctx.fillStyle = PIN_COLOR
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.lineWidth = ring ? 6 : 5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  drawGlyph(ctx, size, paths)
  return { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer) }
}

// MapLibre image id for a bucket. Selected pins are a larger, ringed variant.
function pinId(bucket, selected) {
  return `pin-${bucket}${selected ? '-sel' : ''}`
}

function addPinImages() {
  for (const [bucket, paths] of Object.entries(PIN_GLYPHS)) {
    const base = pinId(bucket, false)
    if (!map.hasImage(base)) {
      map.addImage(base, makePinImage(PIN_SIZE, false, paths), { pixelRatio: 2 })
    }
    const sel = pinId(bucket, true)
    if (!map.hasImage(sel)) {
      map.addImage(sel, makePinImage(PIN_SIZE_SELECTED, true, paths), { pixelRatio: 2 })
    }
  }
}

// `icon-image` expression: build `pin-<bucket>` from the feature's bucket and
// fall back to the `other` pin when the bucket is missing or unrecognised.
function pinImageExpr(selected) {
  const suffix = selected ? '-sel' : ''
  return [
    'coalesce',
    ['image', ['concat', 'pin-', ['get', 'bucket'], suffix]],
    ['image', `pin-other${suffix}`],
  ]
}

function addLayers() {
  // Defensive: if the source is already present (e.g. a stray re-entry),
  // just refresh the data instead of throwing "Source already exists".
  if (map.getSource(SOURCE_ID)) {
    pushData()
    return
  }
  // Add the source FIRST, before addPinImages(). addImage() fires a synchronous
  // `styledata` event; if the source isn't present yet, the styledata re-add
  // handler would re-enter addLayers() and throw "Source already exists". With
  // the source added up front, that handler's `!getSource` guard short-circuits
  // cleanly during image registration.
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: props.data || emptyFC(),
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 14,
  })

  addPinImages()

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': PIN_COLOR,
      'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 24, 500, 28],
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
    },
  })

  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  })

  map.addLayer({
    id: 'unclustered',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': pinImageExpr(false),
      'icon-size': 0.9,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  // Selected pin drawn on top, larger. Filter starts matching nothing.
  map.addLayer({
    id: 'selected',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['==', ['get', 'id'], props.selectedId || ' '],
    layout: {
      'icon-image': pinImageExpr(true),
      'icon-size': 0.9,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  map.on('click', 'clusters', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
    const clusterId = features[0].properties.cluster_id
    map.getSource(SOURCE_ID).getClusterExpansionZoom(clusterId).then((zoom) => {
      map.easeTo({ center: features[0].geometry.coordinates, zoom, animate: !reduceMotion })
    })
  })

  const onPinTap = (e) => {
    const f = e.features?.[0]
    if (f) emit('select', { ...f.properties })
  }
  map.on('click', 'unclustered', onPinTap)
  map.on('click', 'selected', onPinTap)

  for (const layer of ['clusters', 'unclustered', 'selected']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
  }

  pushData()
  // Meetups ride on top of the merchant pins. Async (the logo pin rasterizes
  // from an <img>), so fire-and-forget — the merchant map is already usable.
  void addMeetupLayer()
}

function pushData() {
  const src = map?.getSource(SOURCE_ID)
  if (src) src.setData(props.data || emptyFC())
}

// ── Einundzwanzig meetups layer ─────────────────────────────────────────────
// A separate source + symbol layer using the Einundzwanzig logo as the pin.
// Added once the logo image has rasterized; idempotent so the style-swap
// re-add path (reAddCustomLayers) can call it again safely.
let meetupImageLoading = false
async function addMeetupLayer() {
  if (!map) return

  if (!map.hasImage(MEETUP_IMAGE_ID) && !meetupImageLoading) {
    meetupImageLoading = true
    try {
      const image = await loadEinundzwanzigPinImage(72)
      if (map && !map.hasImage(MEETUP_IMAGE_ID)) {
        map.addImage(MEETUP_IMAGE_ID, image, { pixelRatio: 2 })
      }
    } catch (e) {
      // Logo couldn't rasterize — skip the layer; merchants still render fine.
      console.warn('Einundzwanzig meetup pin unavailable:', e)
      return
    } finally {
      meetupImageLoading = false
    }
  }
  if (!map) return

  if (!map.getSource(MEETUP_SOURCE_ID)) {
    map.addSource(MEETUP_SOURCE_ID, { type: 'geojson', data: props.meetups || emptyFC() })
  }

  if (!map.getLayer('meetups')) {
    map.addLayer({
      id: 'meetups',
      type: 'symbol',
      source: MEETUP_SOURCE_ID,
      layout: {
        'icon-image': MEETUP_IMAGE_ID,
        'icon-size': 0.9,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })

    const onMeetupTap = (e) => {
      const f = e.features?.[0]
      if (!f) return
      const [lon, lat] = f.geometry?.coordinates || []
      emit('select-meetup', { ...f.properties, lat, lon })
    }
    map.on('click', 'meetups', onMeetupTap)
    map.on('mouseenter', 'meetups', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'meetups', () => { map.getCanvas().style.cursor = '' })
  }

  pushMeetupData()
}

function pushMeetupData() {
  const src = map?.getSource(MEETUP_SOURCE_ID)
  if (src) src.setData(props.meetups || emptyFC())
}

function applySelectedFilter() {
  if (map?.getLayer('selected')) {
    map.setFilter('selected', ['==', ['get', 'id'], props.selectedId || ' '])
  }
}

// ── User location marker (blue dot + pulse) ─────────────────────────────────
function renderUserMarker() {
  if (!map || !props.userLocation) return
  const { lat, lon } = props.userLocation
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
  if (!userMarker) {
    const el = document.createElement('div')
    el.className = 'user-dot'
    el.innerHTML = '<span class="user-dot-pulse"></span><span class="user-dot-core"></span>'
    userMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map)
  } else {
    userMarker.setLngLat([lon, lat])
  }
}

// ── Viewport fetch (debounced) ──────────────────────────────────────────────
function emitMove() {
  clearTimeout(viewportTimer)
  viewportTimer = setTimeout(() => {
    if (!map) return
    const b = map.getBounds()
    const c = map.getCenter()
    emit('move', {
      bbox: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      center: { lat: c.lat, lon: c.lng },
      zoom: map.getZoom(),
    })
  }, 700)
}

// ── Public methods ──────────────────────────────────────────────────────────
function flyTo(lat, lon, zoom = 15, opts = {}) {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lon)) return
  // Lift the target into the map area visible ABOVE the sheet so a selected
  // pin is never hidden behind it. offset is in screen px; raising the target
  // by half the sheet height centres it in the visible strip.
  const inset = Number(opts.bottomInset) || 0
  const offset = inset > 0 ? [0, -Math.round(inset / 2)] : [0, 0]
  map.flyTo({ center: [lon, lat], zoom, offset, animate: !reduceMotion })
}
function zoomIn() { map?.zoomIn() }
function zoomOut() { map?.zoomOut() }

defineExpose({ flyTo })

onMounted(() => {
  map = new maplibregl.Map({
    container: mapContainer.value,
    style: props.styleUrl,
    center: [10, 30],
    zoom: 2,
    pitch: props.tilted ? PITCH_3D : 0,
    attributionControl: { compact: true },
    // Honour the OS reduced-motion preference for all camera eases.
    fadeDuration: reduceMotion ? 0 : 300,
  })

  map.on('load', () => {
    addLayers()
    renderUserMarker()
    emit('ready')
    emitMove()
  })
  map.on('moveend', emitMove)
  // Distinct from programmatic flyTo (which fires movestart, not dragstart):
  // a real finger/mouse pan. Lets the page collapse an over-tall sheet so it
  // gets out of the way while the user explores the map.
  map.on('dragstart', () => emit('user-pan'))

})

// Re-add our source/layers/images after a setStyle() swap wiped them. Called
// from the dark watch via map.once('idle'): `idle` is the one reliable signal
// that the new style is fully loaded AND rendered — `styledata` can fire
// before isStyleLoaded() flips true with no further event after, so gating a
// styledata handler on isStyleLoaded misses the window and the pins vanish.
function reAddCustomLayers() {
  if (!map || map.getSource(SOURCE_ID)) return
  addLayers()
  renderUserMarker()
}

onBeforeUnmount(() => {
  clearTimeout(viewportTimer)
  if (userMarker) { userMarker.remove(); userMarker = null }
  if (map) { map.remove(); map = null }
})

watch(() => props.data, () => {
  if (map && map.isStyleLoaded()) pushData()
})

watch(() => props.meetups, () => {
  if (map && map.isStyleLoaded()) pushMeetupData()
})

// Re-style whenever the user picks a different basemap. The chosen tile URL is
// owned by the basemap store and resolved in the page.
watch(() => props.styleUrl, (url) => {
  if (!map || !url) return
  // diff:false forces a clean reload — the default diff keeps our runtime
  // source but drops our custom layers, leaving pins invisible. A full swap
  // wipes everything; `once('idle')` then fires after the new style is fully
  // loaded + rendered, where we re-add source + layers + pin images.
  map.setStyle(url, { diff: false })
  map.once('idle', reAddCustomLayers)
})

// 3D view: tilt/flatten the camera. Animate unless the user prefers reduced
// motion, in which case jump straight to the target pitch.
watch(() => props.tilted, (on) => {
  if (!map) return
  const pitch = on ? PITCH_3D : 0
  if (reduceMotion) map.jumpTo({ pitch })
  else map.easeTo({ pitch, duration: 400 })
})

watch(() => props.selectedId, applySelectedFilter)

watch(() => props.userLocation, renderUserMarker, { deep: true })
</script>

<template>
  <div class="mapview">
    <div ref="mapContainer" class="mapview-canvas" />

    <!-- Thumb-reachable controls, bottom-right, lifted above the sheet. -->
    <div
      class="map-controls"
      :class="{ 'no-anim': !controlsAnimated }"
      :style="{ bottom: bottomInset + 'px' }"
    >
      <button class="map-fab map-fab-solo" type="button" @click="emit('recenter-request')" :aria-label="$t('Find my location')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
        </svg>
      </button>
      <div class="map-fab-group">
        <button class="map-fab map-fab-flat" type="button" @click="zoomIn" :aria-label="$t('Zoom in')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div class="map-fab-divider" />
        <button class="map-fab map-fab-flat" type="button" @click="zoomOut" :aria-label="$t('Zoom out')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mapview {
  position: absolute;
  inset: 0;
}
.mapview-canvas {
  position: absolute;
  inset: 0;
}

/* Controls — 48px targets, bottom-right, ride above the sheet via inline bottom. */
.map-controls {
  position: absolute;
  right: 14px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transition: bottom 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.map-controls.no-anim {
  transition: none;
}
.map-fab {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-md);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.map-fab:active { transform: scale(0.94); }
.map-fab-solo { border-radius: 50%; }
.map-fab-group {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 14px;
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
.map-fab-group .map-fab {
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}
.map-fab-divider {
  height: 1px;
  background: var(--border-card);
  margin: 0 8px;
}

/* User location blue dot. */
:deep(.user-dot) {
  position: relative;
  width: 18px;
  height: 18px;
}
:deep(.user-dot-core) {
  position: absolute;
  inset: 3px;
  background: #2f7bff;
  border: 2px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
}
:deep(.user-dot-pulse) {
  position: absolute;
  inset: 0;
  background: rgba(47, 123, 255, 0.35);
  border-radius: 50%;
  animation: user-dot-pulse 2s ease-out infinite;
}
@keyframes user-dot-pulse {
  0% { transform: scale(0.6); opacity: 0.8; }
  100% { transform: scale(2.2); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  :deep(.user-dot-pulse) { animation: none; }
}
</style>
