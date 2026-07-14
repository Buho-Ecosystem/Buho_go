<template>
  <q-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="get-app-card"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <q-card-section class="get-app-header">
        <div class="get-app-icon-wrapper">
          <Icon
            icon="tabler:device-mobile-down"
            width="32"
            height="32"
            class="get-app-icon"
          />
        </div>
        <div class="get-app-title">{{ $t('Get the BuhoGO Android app') }}</div>
        <div
          class="get-app-message"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
        >
          {{ message }}
        </div>
      </q-card-section>

      <q-card-actions class="get-app-actions">
        <q-btn
          flat
          no-caps
          :label="$t('Cancel')"
          v-close-popup
          class="cancel-btn"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
        />
        <q-btn
          unelevated
          no-caps
          :label="$t('Open Google Play')"
          class="get-app-cta-btn"
          @click="openPlayStore"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';

/**
 * Shared "this feature is Android-only" interstitial. Every native-only
 * feature (Learn & Earn, biometric lock, screen privacy) reaches for the
 * same dialog with a different `message`, so the Play Store link and
 * styling live in exactly one place instead of drifting across callers.
 */
export default {
  name: 'GetAppDialog',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, required: true },
    message: { type: String, required: true },
  },
  emits: ['update:modelValue'],
  methods: {
    /**
     * Open the BuhoGO Android Play Store listing in a new tab, then close
     * the dialog so a user returning to this tab sees the page underneath,
     * not a stale modal.
     *
     * App ID matches `appId` in src-capacitor/capacitor.config.json and
     * the badge link in README.md - single canonical URL.
     */
    openPlayStore() {
      window.open(
        'https://play.google.com/store/apps/details?id=mybuho.buhogo',
        '_blank',
        'noopener,noreferrer'
      );
      this.$emit('update:modelValue', false);
    },
  },
};
</script>

<style scoped>
.get-app-card {
  width: 100%;
  max-width: 360px;
  border-radius: var(--radius-md, 16px);
  padding: 8px;
}

.get-app-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 20px 16px 8px;
}

.get-app-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-accent-soft);
}

.get-app-icon {
  color: var(--brand-accent);
}

.get-app-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}

.get-app-message {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  line-height: 1.4;
}

.get-app-actions {
  padding: 8px 16px 16px;
  gap: 8px;
}

.get-app-cta-btn {
  flex: 1;
  background: var(--brand-accent);
  color: #0E1F17;
  border-radius: 12px;
  font-weight: 700;
  font-family: 'Manrope', sans-serif;
}

.cancel-btn {
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
}
</style>
