<!--
  DisplaySheet: how BuhoGO looks, opened from the Display row in Settings.
  Theme, the unit Home shows first, hidden balances and how amounts are
  written, each a pick-one group with a check on the current choice. The
  sheet only reports choices; Settings owns every setter, so the theme sweep,
  persistence and the format notice stay where they were.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="display-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" data-audit="settings-display-sheet">
      <div class="form-sheet-grabber" aria-hidden="true"></div>
      <header class="form-sheet-header">
        <span aria-hidden="true"></span>
        <h2 class="form-sheet-title">{{ $t('Display') }}</h2>
        <button type="button" class="form-sheet-cancel display-done" @click="open = false">{{ $t('Done') }}</button>
      </header>

      <div class="display-body">
        <SettingsChoiceGroup :title="$t('Appearance')" :options="themeOptions" :model-value="dark ? 'dark' : 'light'" @update:model-value="$emit('toggle-theme')" />
        <SettingsChoiceGroup :title="$t('Main unit')" :options="unitOptions" :model-value="mainUnit" @update:model-value="$emit('main-unit', $event)" />

        <SettingsSection>
          <SettingsRow :label="$t('Hide balances')" :interactive="false">
            <template #right>
              <q-toggle
                :model-value="balanceHidden"
                :aria-label="$t('Hide balances')"
                :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
                @update:model-value="$emit('toggle-hidden')"
              />
            </template>
          </SettingsRow>
          <template #footer>{{ $t('Home opens on the main unit. Tapping the balance on Home switches the unit or hides it.') }}</template>
        </SettingsSection>

        <SettingsChoiceGroup :title="$t('Amount format')" :options="formatOptions" :model-value="bip177" @update:model-value="$emit('amount-format', $event)" />
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import SettingsSection from './SettingsSection.vue';
import SettingsRow from './SettingsRow.vue';
import SettingsChoiceGroup from './SettingsChoiceGroup.vue';

export default {
  name: 'DisplaySheet',
  components: { SettingsSection, SettingsRow, SettingsChoiceGroup },
  props: {
    modelValue: { type: Boolean, default: false },
    dark: { type: Boolean, default: false },
    /** 'bitcoin' or 'fiat': what Home shows first. */
    mainUnit: { type: String, default: 'bitcoin' },
    /** The fiat currency code the user picked (EUR, USD, ...). */
    fiatCode: { type: String, default: '' },
    balanceHidden: { type: Boolean, default: false },
    /** true: ₿ 1,234; false: 1,234 sats. */
    bip177: { type: Boolean, default: true },
  },
  emits: ['update:modelValue', 'toggle-theme', 'main-unit', 'toggle-hidden', 'amount-format'],
  computed: {
    open: {
      get() { return this.modelValue; },
      set(value) { this.$emit('update:modelValue', value); },
    },
    themeOptions() {
      return [
        { value: 'light', label: this.$t('Light') },
        { value: 'dark', label: this.$t('Dark') },
      ];
    },
    unitOptions() {
      return [
        { value: 'bitcoin', label: this.$t('Bitcoin') },
        { value: 'fiat', label: this.fiatCode || this.$t('Currency') },
      ];
    },
    // The two ways the app can write an amount, shown the way they look.
    formatOptions() {
      return [
        { value: true, label: this.$t('Show amounts as ₿ 1,234') },
        { value: false, label: this.$t('Show amounts as 1,234 sats') },
      ];
    },
  },
};
</script>

<style scoped>
.display-card { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; padding-bottom: max(20px, var(--safe-bottom, 0px)); max-height: min(90dvh, calc(100dvh - var(--safe-top, 0px) - 8px)); overflow-y: auto; }
.display-body { padding: 4px 16px 0; }
.display-done { justify-self: end; font-weight: 600; }
</style>
