<template>
  <!--
    Tap-to-open help tooltip for the shop. Generalises the stay-open pattern
    from ProfileEditSheet (info-btn + q-menu `no-parent-event`) into a titled,
    numbered "how it works" explainer.

    Why q-menu and not q-tooltip: q-tooltip is hover / long-press and
    auto-dismisses, which is wrong on touch. q-menu opens on tap, STAYS open on
    content taps (no v-close-popup inside), dismisses on outside tap / Escape,
    and its anchor/self flipping plus the width clamp keep it on screen.
  -->
  <button
    type="button"
    class="info-btn"
    :class="$q.dark.isActive ? 'info-btn-dark' : 'info-btn-light'"
    :aria-label="ariaLabel || $t('How it works')"
    aria-haspopup="dialog"
    :aria-expanded="open ? 'true' : 'false'"
    @click.prevent.stop="open = !open"
  >
    <Icon :icon="triggerIcon" width="15" height="15" />
    <q-menu
      v-model="open"
      anchor="bottom left"
      self="top left"
      :offset="[0, 8]"
      no-parent-event
      max-width="320px"
      transition-show="jump-down"
      transition-hide="jump-up"
      role="dialog"
      :aria-labelledby="titleId"
    >
      <div
        class="info-tooltip"
        :class="$q.dark.isActive ? 'info-tooltip-dark' : 'info-tooltip-light'"
      >
        <div class="info-tooltip-head">
          <span
            class="info-tooltip-icon"
            :class="tone === 'bolt' ? 'info-tooltip-icon--bolt' : 'info-tooltip-icon--check'"
          >
            <Icon :icon="icon" width="16" height="16" />
          </span>
          <span
            :id="titleId"
            class="info-tooltip-title"
            :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
          >
            {{ title }}
          </span>
        </div>

        <p
          v-if="lede"
          class="info-tooltip-lede"
          :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
        >
          {{ lede }}
        </p>

        <ol class="info-tooltip-steps" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          <li v-for="(s, i) in steps" :key="i">{{ s }}</li>
        </ol>
      </div>
    </q-menu>
  </button>
</template>

<script>
import { Icon } from '@iconify/vue';

/**
 * Reusable shop help tooltip. Copy is passed as props so the parent owns i18n.
 *
 * @prop {string} title       Outcome-stated heading (aria-labelledby target).
 * @prop {string[]} steps     3-5 short step strings, rendered as an ordered list.
 * @prop {string} lede        Optional one-line summary above the steps.
 * @prop {string} icon        Iconify name for the tinted head chip.
 * @prop {'brand'|'bolt'} tone  Head-chip tint (green or amber).
 * @prop {string} ariaLabel   Trigger accessible name (falls back to "How it works").
 * @prop {string} triggerIcon Glyph inside the trigger button.
 */
export default {
  name: 'ShopInfoTooltip',
  components: { Icon },
  props: {
    title: { type: String, required: true },
    steps: { type: Array, default: () => [] },
    lede: { type: String, default: '' },
    icon: { type: String, default: 'tabler:info-circle' },
    tone: { type: String, default: 'brand' },
    ariaLabel: { type: String, default: '' },
    triggerIcon: { type: String, default: 'tabler:info-circle' },
  },
  data() {
    // Per-instance id so multiple tooltips on one screen don't collide.
    return { open: false, titleId: `shop-info-${Math.random().toString(36).slice(2, 9)}` };
  },
};
</script>

<style scoped>
/* Trigger — verbatim from ProfileEditSheet's info-btn, with a 44px hit target. */
.info-btn {
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  position: relative;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease, color 0.15s ease;
}
/* Invisible 44px tap target without changing the visual size. */
.info-btn::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
}
.info-btn-light { color: #94a3b8; }
.info-btn-dark { color: #64748b; }
.info-btn-light:hover,
.info-btn-light:focus-visible { background: rgba(15, 23, 42, 0.06); color: #334155; }
.info-btn-dark:hover,
.info-btn-dark:focus-visible { background: rgba(255, 255, 255, 0.06); color: #cbd5e1; }
.info-btn:focus-visible { outline: 2px solid #15DE72; outline-offset: 2px; }

/* Panel — verbatim from ProfileEditSheet's info-tooltip; the width clamp keeps
   it within the viewport horizontally, q-menu flips it vertically. */
.info-tooltip {
  width: min(320px, calc(100vw - 32px));
  padding: 14px 16px 16px;
  border-radius: 14px;
  font-family: 'Manrope', sans-serif;
}
.info-tooltip-light {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04), 0 16px 32px -12px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(15, 23, 42, 0.08);
}
.info-tooltip-dark {
  background: #1e293b;
  color: #f8fafc;
  box-shadow: 0 16px 32px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.info-tooltip-head { display: flex; align-items: center; gap: 10px; margin: 0 0 10px 0; }
.info-tooltip-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; }
.info-tooltip-icon--bolt { background: rgba(247, 147, 26, 0.14); color: #f7931a; }
.info-tooltip-icon--check { background: rgba(21, 222, 114, 0.16); color: #15a35b; }
body.body--dark .info-tooltip-icon--check { color: #2bd17f; }
.info-tooltip-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.info-tooltip-lede { font-size: 14px; font-weight: 600; line-height: 1.4; letter-spacing: -0.005em; margin: 0 0 8px 0; }

/* Numbered steps. */
.info-tooltip-steps {
  margin: 0;
  padding-left: 1.15em;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: -0.003em;
  white-space: normal;
  overflow-wrap: anywhere;
}
.info-tooltip-steps li { margin-bottom: 6px; }
.info-tooltip-steps li:last-child { margin-bottom: 0; }

/* Theme text pairs (scoped per component, per the app convention). */
.item-label-light { color: #0f172a; }
.item-label-dark { color: #f8fafc; }
</style>
