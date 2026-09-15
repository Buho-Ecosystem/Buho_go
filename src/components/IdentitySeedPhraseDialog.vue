<template>
  <RecoveryPhraseDialog :model-value="modelValue" kind="identity" :mode="mode" @update:model-value="$emit('update:modelValue', $event)" @verified="$emit('verified')" />
</template>

<script setup>
import RecoveryPhraseDialog from './RecoveryPhraseDialog.vue';
defineProps({ modelValue: Boolean, mode: { type: String, required: true }, labelPaper: Boolean });
defineEmits(['update:modelValue', 'verified']);
</script>
