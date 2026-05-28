<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

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
const PIN_COLOR = '#f7931a' // Bitcoin orange — same in both themes for brand consistency.

const props = defineProps({
  // GeoJSON FeatureCollection from the store.
  data: { type: Object, default: () => ({ type: 'FeatureCollection', features: [] }) },
  // Resolved basemap tile-style URL (chosen in the map's style picker).
  styleUrl: { type: String, required: true },
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

const emit = defineEmits(['ready', 'select', 'move', 'recenter-request', 'user-pan'])

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

// ── Pin images (canvas-rendered so the ₿ glyph is always present, regardless
// of the basemap font set) ────────────────────────────────────────────────
function makePinImage(size, ring) {
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
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(size * 0.5)}px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('₿', size / 2, size / 2 + 2)
  return { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer) }
}

function addPinImages() {
  if (!map.hasImage('btc-pin')) map.addImage('btc-pin', makePinImage(64, false), { pixelRatio: 2 })
  if (!map.hasImage('btc-pin-selected')) map.addImage('btc-pin-selected', makePinImage(84, true), { pixelRatio: 2 })
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
      'icon-image': 'btc-pin',
      'icon-size': 0.5,
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
      'icon-image': 'btc-pin-selected',
      'icon-size': 0.5,
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
}

function pushData() {
  const src = map?.getSource(SOURCE_ID)
  if (src) src.setData(props.data || emptyFC())
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
      <button class="map-fab map-fab-solo" type="button" @click="emit('recenter-request')" aria-label="Find my location">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
        </svg>
      </button>
      <div class="map-fab-group">
        <button class="map-fab map-fab-flat" type="button" @click="zoomIn" aria-label="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div class="map-fab-divider" />
        <button class="map-fab map-fab-flat" type="button" @click="zoomOut" aria-label="Zoom out">
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
