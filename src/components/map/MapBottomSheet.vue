<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

/**
 * MapBottomSheet — a draggable bottom sheet with three detents
 * (peek / half / full), the pattern Google/Apple Maps and Airbnb converged on.
 *
 * Interaction model (deliberately unambiguous):
 *   - The HEADER strip (grabber + whatever the caller slots in) is the drag
 *     handle. Drag it to resize; a tap on it steps to the next detent.
 *   - The BODY is an independent scroll container. No gesture ambiguity
 *     between "scroll the list" and "resize the sheet".
 *   - The map stays interactive: only the sheet itself captures pointers; the
 *     map area above the sheet is untouched.
 *
 * Heights: peek is a fixed pixel height (handle + summary + a hint of the
 * first row); half/full are viewport fractions, with full leaving a sliver of
 * map per the research. Recomputed on resize.
 *
 * Emits `height` continuously during drag so the parent can lift the map
 * controls above the sheet, and `dragging` so it can drop the controls'
 * transition for 1:1 tracking.
 */

const PEEK_PX = 124
const HALF_FRACTION = 0.5
const FULL_FRACTION = 0.88
const TAP_THRESHOLD_PX = 6

const props = defineProps({
  modelValue: { type: String, default: 'peek' }, // 'peek' | 'half' | 'full'
})
const emit = defineEmits(['update:modelValue', 'height', 'dragging'])

const viewportH = ref(typeof window !== 'undefined' ? window.innerHeight : 800)
const sheetHeight = ref(PEEK_PX)
const dragging = ref(false)

const detents = computed(() => ({
  peek: PEEK_PX,
  half: Math.round(viewportH.value * HALF_FRACTION),
  full: Math.round(viewportH.value * FULL_FRACTION),
}))

function heightFor(detent) {
  return detents.value[detent] ?? PEEK_PX
}

function nearestDetent(px) {
  const entries = Object.entries(detents.value)
  let best = entries[0][0]
  let bestDist = Infinity
  for (const [name, h] of entries) {
    const d = Math.abs(h - px)
    if (d < bestDist) { bestDist = d; best = name }
  }
  return best
}

function settleTo(detent) {
  dragging.value = false
  emit('dragging', false)
  sheetHeight.value = heightFor(detent)
  if (detent !== props.modelValue) emit('update:modelValue', detent)
}

// ── Drag handling (pointer events cover touch + mouse) ──────────────────────
let startY = 0
let startHeight = 0
let pointerMoved = 0
let activePointer = null

function onPointerDown(e) {
  activePointer = e.pointerId
  startY = e.clientY
  startHeight = sheetHeight.value
  pointerMoved = 0
  dragging.value = true
  emit('dragging', true)
  e.currentTarget.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!dragging.value || e.pointerId !== activePointer) return
  const dy = startY - e.clientY // up = positive = taller
  pointerMoved = Math.max(pointerMoved, Math.abs(dy))
  const next = Math.min(
    heightFor('full'),
    Math.max(PEEK_PX, startHeight + dy),
  )
  sheetHeight.value = next
}

function onPointerUp(e) {
  if (e.pointerId !== activePointer) return
  activePointer = null
  if (pointerMoved < TAP_THRESHOLD_PX) {
    // Treat as a tap on the handle: step up, or collapse from full.
    stepDetent()
    return
  }
  settleTo(nearestDetent(sheetHeight.value))
}

function stepDetent() {
  const order = ['peek', 'half', 'full']
  const i = order.indexOf(props.modelValue)
  if (props.modelValue === 'full') settleTo('half')
  else settleTo(order[Math.min(order.length - 1, i + 1)])
}

// ── Public API ──────────────────────────────────────────────────────────────
function setDetent(detent) {
  settleTo(detent)
}
defineExpose({ setDetent })

// ── Reactivity wiring ───────────────────────────────────────────────────────
function onResize() {
  viewportH.value = window.innerHeight
  // Keep the current detent's height in sync after a rotate/resize.
  if (!dragging.value) sheetHeight.value = heightFor(props.modelValue)
}

watch(sheetHeight, (h) => emit('height', h))
watch(
  () => props.modelValue,
  (detent) => { if (!dragging.value) sheetHeight.value = heightFor(detent) },
)

onMounted(() => {
  viewportH.value = window.innerHeight
  sheetHeight.value = heightFor(props.modelValue)
  emit('height', sheetHeight.value)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <section
    class="map-sheet"
    :class="{ dragging }"
    :style="{ height: sheetHeight + 'px' }"
    role="dialog"
    :aria-label="$t('Nearby Bitcoin places')"
  >
    <header
      class="map-sheet-header"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="map-sheet-grabber" aria-hidden="true" />
      <slot name="header" />
    </header>

    <div class="map-sheet-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.map-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-top: 1px solid var(--border-card);
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.18);
  /* Smooth snap when not actively dragging; instant follow while dragging. */
  transition: height 260ms cubic-bezier(0.22, 1, 0.36, 1);
  touch-action: none;
  overflow: hidden;
}
.map-sheet.dragging {
  transition: none;
}

.map-sheet-header {
  flex-shrink: 0;
  padding: 8px 16px 6px;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.map-sheet-header:active { cursor: grabbing; }

.map-sheet-grabber {
  width: 40px;
  height: 5px;
  margin: 0 auto 4px;
  border-radius: 999px;
  background: var(--border-card);
}

.map-sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding-bottom: max(16px, var(--safe-bottom, 0px));
}
</style>
