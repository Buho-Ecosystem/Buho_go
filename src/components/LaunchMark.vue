<!--
  LaunchMark
  The first frame of the app, and how it becomes the home screen.

  It mounts as an exact copy of the launch frame (the native splash on
  Android, index.html's frame on the web): the mark, centred, on the home
  screen's background. Drawing that copy is what lets the stand-ins go
  (utils/launch.js), so the hand-over has no seam.

  Then one of two things happens, depending on how fast the saved wallets
  load (`ready`):
    - Quickly (a warm process, a small store): the mark travels straight to
      its place in the toolbar while the background lifts off the home
      screen beneath it.
    - Slowly (a cold start): the three shapes of the mark breathe in turn,
      the mark itself as the loading indicator, until the wallets are in;
      then it travels the same way.

  The travel is a single transform from the centre to the toolbar logo's
  box (`target`), so the mark the person was looking at is the one that
  lands. Reduce Motion: no travel, no breathing, a short fade. `done` fires
  once the mark has landed; the parent then shows its own toolbar logo and
  removes this component.

  Decorative only (aria-hidden): the home screen underneath carries the
  content a screen reader announces.
-->
<template>
  <div
    class="launch"
    :class="[`launch--${phase}`, { 'launch--dark': $q.dark.isActive }]"
    aria-hidden="true"
  >
    <svg
      ref="mark"
      class="launch-mark"
      :style="markStyle"
      viewBox="0 0 30 32"
      fill="none"
      @transitionend.self="onLanded"
    >
      <path class="launch-leaf" d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z" fill="#059573" />
      <path class="launch-dot launch-dot--top" d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z" fill="#78D53C" />
      <path class="launch-dot launch-dot--bottom" d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z" fill="#43B65B" />
    </svg>
  </div>
</template>

<script>
import { LAUNCH_MARK_SIZE, releaseLaunch } from '../utils/launch.js'

/** Wallets in by then: no breathing, straight to the toolbar. */
const QUICK_MS = 350
/** A breath winding down before the travel, so no shape jumps. */
const SETTLE_MS = 180
/** If the transition never reports its end (hidden tab, interrupted). */
const LAND_FALLBACK_MS = 900

const MARK_RATIO = 32 / 30

export default {
  name: 'LaunchMark',
  props: {
    /** The saved wallets are loaded; the home screen beneath can be shown. */
    ready: { type: Boolean, default: false },
    /** Returns the element the mark lands on (the toolbar logo). */
    target: { type: Function, required: true },
  },
  emits: ['done'],
  data() {
    return {
      // hold: the launch frame · breathe: waiting · settle: a breath ending
      // · travel: on its way · fade: Reduce Motion or no target
      phase: 'hold',
      flight: null,
    }
  },
  computed: {
    markStyle() {
      const size = { width: `${LAUNCH_MARK_SIZE}px`, height: `${LAUNCH_MARK_SIZE * MARK_RATIO}px` }
      return this.flight ? { ...size, transform: this.flight } : size
    },
  },
  watch: {
    ready(isReady) {
      if (isReady && this.uncovered && (this.phase === 'hold' || this.phase === 'breathe')) this.leave()
    },
  },
  created() {
    // Plain fields, not reactive state: nothing on screen depends on them.
    this.uncovered = false // the native splash / launch frame are gone
    this.landed = false
    this.unmounted = false
  },
  mounted() {
    // This frame is now on screen: the stand-ins can go without a seam.
    // Nothing moves until they are gone (Android holds its splash a moment
    // longer to finish building the mark).
    releaseLaunch().then(() => {
      if (this.unmounted) return
      this.uncovered = true
      this.quickTimer = setTimeout(() => {
        if (this.phase === 'hold' && !this.ready) this.phase = 'breathe'
      }, QUICK_MS)
      if (this.ready) this.leave()
    })
  },
  beforeUnmount() {
    this.unmounted = true
    clearTimeout(this.quickTimer)
    clearTimeout(this.settleTimer)
    clearTimeout(this.landTimer)
  },
  methods: {
    leave() {
      clearTimeout(this.quickTimer)
      if (this.phase === 'breathe') {
        // Let the shapes come back to rest first.
        this.phase = 'settle'
        this.settleTimer = setTimeout(() => this.fly(), SETTLE_MS)
      } else {
        this.fly()
      }
    },

    /** One transform from the centred mark onto the toolbar logo's box. */
    fly() {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const from = this.$refs.mark?.getBoundingClientRect()
      const to = this.target()?.getBoundingClientRect?.()
      if (reduceMotion || !from || !to || !to.width) {
        this.phase = 'fade'
        this.landTimer = setTimeout(() => this.$emit('done'), 260)
        return
      }
      // The toolbar draws the mark fitted into a square box: fit, don't fill.
      const scale = Math.min(to.width / from.width, to.height / from.height)
      const dx = (to.left + to.width / 2) - (from.left + from.width / 2)
      const dy = (to.top + to.height / 2) - (from.top + from.height / 2)
      this.phase = 'travel'
      this.flight = `translate(${dx}px, ${dy}px) scale(${scale})`
      this.landTimer = setTimeout(() => this.onLanded(), LAND_FALLBACK_MS)
    },

    onLanded(event) {
      if (event && event.propertyName !== 'transform') return
      if (this.phase !== 'travel' || this.landed) return
      this.landed = true
      clearTimeout(this.landTimer)
      this.$emit('done')
    },
  },
}
</script>

<style scoped>
.launch {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: grid;
  place-items: center;
  pointer-events: none;
  /* The home screen's own background: the frame IS the home screen, empty. */
  background-color: #FAF7EF;
  transition: background-color 0.42s ease;
}
.launch--dark { background-color: #171717; }

/* Lifting off: the background goes while the mark travels. */
.launch--travel,
.launch--fade { background-color: transparent; }
.launch--fade { opacity: 0; transition: opacity 0.24s ease, background-color 0.24s ease; }

.launch-mark {
  display: block;
  overflow: visible;
  transform-origin: center;
  will-change: transform;
}
.launch--travel .launch-mark {
  /* A short, decisive move that settles: spring-like, no overshoot. */
  transition: transform 0.56s cubic-bezier(0.2, 0.9, 0.25, 1);
}

.launch-leaf,
.launch-dot {
  transform-box: fill-box;
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.launch-leaf { transform-origin: 50% 100%; }
.launch-dot { transform-origin: center; }

/* Waiting: the mark breathes, shape after shape, as the loading indicator. */
.launch--breathe .launch-dot--top { animation: launch-breathe 1.2s ease-in-out infinite; }
.launch--breathe .launch-dot--bottom { animation: launch-breathe 1.2s 0.4s ease-in-out infinite; }
.launch--breathe .launch-leaf { animation: launch-breathe-leaf 1.2s 0.8s ease-in-out infinite; }

@keyframes launch-breathe {
  50% { transform: scale(0.78); opacity: 0.7; }
}
@keyframes launch-breathe-leaf {
  50% { transform: scaleY(0.9); opacity: 0.8; }
}

@media (prefers-reduced-motion: reduce) {
  .launch--breathe .launch-leaf,
  .launch--breathe .launch-dot { animation: none; }
}
</style>
