<!--
  SettingsChoiceGroup: a pick-one group in a grouped list, with a check on
  the current choice (Appearance, Main unit, Amount format). It is one radio
  group for assistive technology and the keyboard, as the WAI-ARIA radio
  group pattern describes: Tab reaches it once, on the current choice, and
  the arrow keys, Home and End move the choice. It emits a choice only when
  it differs; the owner applies it.
-->
<template>
  <SettingsSection :title="title" role="radiogroup" :aria-label="title">
    <SettingsRow
      v-for="(option, index) in options"
      :key="String(option.value)"
      :label="option.label"
      role="radio"
      :show-chevron="false"
      :aria-checked="String(index === checkedIndex)"
      :tabindex="index === tabIndex ? 0 : -1"
      @click="choose(index)"
      @keydown="onKeydown($event, index)"
    >
      <template #right>
        <Icon v-if="index === checkedIndex" icon="tabler:check" width="20" height="20" class="settings-choice-check" />
      </template>
    </SettingsRow>
  </SettingsSection>
</template>

<script>
import { Icon } from '@iconify/vue';
import SettingsSection from './SettingsSection.vue';
import SettingsRow from './SettingsRow.vue';

const STEPS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export default {
  name: 'SettingsChoiceGroup',
  components: { Icon, SettingsSection, SettingsRow },
  props: {
    title: { type: String, required: true },
    /** [{ value, label }] */
    options: { type: Array, required: true },
    modelValue: { type: [String, Number, Boolean], default: null },
  },
  emits: ['update:modelValue'],
  computed: {
    checkedIndex() {
      return this.options.findIndex((option) => option.value === this.modelValue);
    },
    /** The one choice Tab reaches: the checked one, or the first when none is. */
    tabIndex() {
      return Math.max(0, this.checkedIndex);
    },
  },
  methods: {
    choose(index) {
      const option = this.options[index];
      if (option && option.value !== this.modelValue) this.$emit('update:modelValue', option.value);
    },
    onKeydown(event, index) {
      const count = this.options.length;
      let target = null;
      if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = count - 1;
      else if (Object.hasOwn(STEPS, event.key)) target = (index + STEPS[event.key] + count) % count;
      if (target === null) return;
      event.preventDefault();
      this.$el.querySelectorAll('[role="radio"]')[target]?.focus();
      this.choose(target);
    },
  },
};
</script>

<style scoped>
.settings-choice-check { color: var(--brand-accent-text); }
</style>
