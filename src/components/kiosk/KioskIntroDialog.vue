<!--
  KioskIntroDialog: what Kiosk Mode is, shown once, the first time the Kiosk
  Mode page opens (issue #449). Continue stays on the page, Cancel goes back.

  The hero SVG carries its own CSS keyframes and is served through <img>, so
  it plays in a sandbox. Chromium and WebKit can keep the last frame of an
  image they already rendered, so every open changes both the :key (a new
  DOM node) and the URL query (a new resource) to start it from frame 0.
-->
<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
    @before-show="replay += 1"
  >
    <div class="kiosk-intro">
      <div class="kiosk-intro-hero">
        <img
          :key="replay"
          :src="`/Onboarding wizard spark/scan-to-pay-animated.svg?v=${replay}`"
          class="kiosk-intro-illustration"
          alt=""
          aria-hidden="true"
          draggable="false"
        />
      </div>

      <h3 class="kiosk-intro-title">{{ $t('kiosk.kioskMode') }}</h3>
      <p class="kiosk-intro-desc">{{ $t('kiosk.introDesc') }}</p>

      <div class="kiosk-intro-features">
        <div class="kiosk-intro-feature">
          <div class="kiosk-intro-feature-icon"><Icon icon="tabler:lock" width="18" height="18" /></div>
          <span>{{ $t('kiosk.introFeaturePos') }}</span>
        </div>
        <div class="kiosk-intro-feature">
          <div class="kiosk-intro-feature-icon"><Icon icon="tabler:shield-lock" width="18" height="18" /></div>
          <span>{{ $t('kiosk.introFeatureLock') }}</span>
        </div>
        <div class="kiosk-intro-feature">
          <div class="kiosk-intro-feature-icon"><Icon icon="tabler:password" width="18" height="18" /></div>
          <span>{{ $t('kiosk.introFeaturePin') }}</span>
        </div>
      </div>

      <button type="button" class="kiosk-intro-primary" @click="$emit('continue')">{{ $t('kiosk.introContinue') }}</button>
      <button type="button" class="kiosk-intro-secondary" @click="$emit('cancel')">{{ $t('Cancel') }}</button>
    </div>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';

export default {
  name: 'KioskIntroDialog',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'continue', 'cancel'],
  data() {
    return { replay: 0 };
  },
};
</script>

<style scoped>
.kiosk-intro {
  width: 90vw; max-width: 420px;
  border-radius: var(--radius-lg);
  padding: 20px 24px 28px;
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
  background: var(--bg-card);
  color: var(--text-primary);
}

/* Clips the QR-code skew so it never reaches past the dialog edge. */
.kiosk-intro-hero {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 8px;
  overflow: hidden;
}

.kiosk-intro-illustration {
  width: 100%;
  max-width: 340px;
  height: auto;
  user-select: none;
  pointer-events: none;
}

.kiosk-intro-title {
  font-family: 'Manrope', sans-serif;
  font-size: 1.25rem; font-weight: 800;
  margin: 0 0 8px; color: var(--text-primary);
}

.kiosk-intro-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 0.875rem; line-height: 1.5;
  color: var(--text-secondary);
  margin: 0 0 20px; max-width: 300px;
}

.kiosk-intro-features {
  width: 100%; display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 24px;
}

.kiosk-intro-feature {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-radius: var(--radius-sm);
  background: var(--bg-input); text-align: left;
  font-family: 'Manrope', sans-serif; font-size: 0.875rem; font-weight: 500;
  color: var(--text-secondary);
}

.kiosk-intro-feature-icon {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-secondary); color: var(--text-muted);
}

.kiosk-intro-primary {
  width: 100%;
  height: 50px;
  border: none;
  border-radius: 16px;
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
  font-family: 'Manrope', sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: filter 0.18s ease, transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.kiosk-intro-primary:hover { filter: brightness(1.06); }
.kiosk-intro-primary:active { transform: scale(0.98); filter: brightness(0.94); }

/* The neutral primary pill every call to action uses on cream. */
body.body--light .kiosk-intro-primary {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
  box-shadow: none;
}

.kiosk-intro-secondary {
  background: none; border: none;
  color: var(--text-muted);
  font-family: 'Manrope', sans-serif; font-size: 0.875rem; font-weight: 500;
  cursor: pointer; padding: 12px 16px; margin-top: 4px;
  -webkit-tap-highlight-color: transparent;
}
.kiosk-intro-secondary:active { opacity: 0.6; }
</style>
