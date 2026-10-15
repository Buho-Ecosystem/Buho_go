<template>
  <div class="request-note">
    <input
      v-if="open || modelValue"
      ref="input"
      :value="modelValue"
      type="text"
      autocomplete="off"
      enterkeyhint="done"
      :maxlength="MAX_NOTE_LENGTH"
      :placeholder="$t('What is it for?')"
      :aria-label="$t('Note (optional)')"
      :disabled="disabled"
      @input="$emit('update:modelValue', $event.target.value)"
      @blur="open = Boolean(modelValue.trim())"
      @keydown.enter.prevent="$event.target.blur()"
    />
    <button v-else type="button" :disabled="disabled" @click="show">
      <Icon icon="tabler:notes" width="16" height="16" />{{ $t('Add a note') }}
    </button>
  </div>
</template>
<script setup>
import { nextTick, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { MAX_NOTE_LENGTH } from '../../services/dm/constants.js'
const props = defineProps({
  modelValue: { type: String, default: '' },
  initiallyOpen: Boolean,
  disabled: Boolean
})
defineEmits(['update:modelValue'])
const open = ref(props.initiallyOpen)
const input = ref(null)
function show() {
  open.value = true
  nextTick(() => input.value?.focus())
}
</script>
<style scoped>
.request-note {
  width: 100%;
  padding: 0 20px;
  text-align: center;
  min-height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.request-note input {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  background: none;
  color: var(--text-primary);
  font:
    500 13px 'Manrope',
    sans-serif;
  text-align: center;
  min-width: 0;
}
.request-note button {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font:
    500 12px 'Manrope',
    sans-serif;
  cursor: pointer;
}
.request-note input:focus {
  outline: none;
  border-bottom-color: var(--brand-accent-text);
  box-shadow: 0 1px 0 var(--brand-accent-text);
}
.request-note button:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
}
</style>
