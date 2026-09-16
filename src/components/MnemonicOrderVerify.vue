<template>
  <div class="mnemonic-order-verify">
    <div class="recovery-word-grid" :aria-label="$t('wosBackup.check')">
      <button
        v-for="(word, index) in shuffledWords" :key="index" type="button"
        class="recovery-word-tile word-chip"
        :class="{ 'chip-selected': positions[index], 'chip-error': errorIndex === index }"
        :disabled="busy || !!positions[index]"
        :aria-label="positions[index] ? `${word}, ${positions[index]}` : word"
        @click="select(index)"
      >
        <span v-if="positions[index]" class="recovery-word-number" aria-hidden="true">{{ positions[index] }}</span>
        <span>{{ word }}</span>
      </button>
    </div>
    <p class="recovery-verify-feedback" :class="{ 'recovery-sr-only': !errorMessage }" role="status" aria-live="polite">
      {{ errorMessage || `${selected.length}/${mnemonic.length}` }}
    </p>
  </div>
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue';
const props = defineProps({ mnemonic: { type: Array, required: true }, busy: Boolean });
const emit = defineEmits(['complete']);
const { proxy } = getCurrentInstance();
const shuffledWords = ref([]);
const selected = ref([]);
const errorIndex = ref(null);
const errorMessage = ref('');
const positions = computed(() => Object.fromEntries(selected.value.map((index, position) => [index, position + 1])));

watch(() => props.mnemonic, (words) => {
  shuffledWords.value = [...words];
  for (let i = shuffledWords.value.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledWords.value[i], shuffledWords.value[j]] = [shuffledWords.value[j], shuffledWords.value[i]];
  }
  selected.value = [];
  errorIndex.value = null;
  errorMessage.value = '';
  emit('complete', false);
}, { immediate: true });

function select(index) {
  if (props.busy || positions.value[index] || selected.value.length === props.mnemonic.length) return;
  errorIndex.value = null;
  errorMessage.value = '';
  // Match text so repeated words can be chosen in either visual order.
  if (shuffledWords.value[index] !== props.mnemonic[selected.value.length]) {
    errorIndex.value = index;
    errorMessage.value = proxy.$t('Check word {number} on your paper and try again.', { number: selected.value.length + 1 });
    return;
  }
  selected.value.push(index);
  emit('complete', selected.value.length === props.mnemonic.length);
}
</script>
