<template>
  <RecoveryPhraseDialog :model-value="modelValue" kind="wallet" :mode="mode" :wallet-id="walletId" @update:model-value="$emit('update:modelValue', $event)" @verified="$emit('verified')" />
</template>

<script setup>
import RecoveryPhraseDialog from './RecoveryPhraseDialog.vue';
defineProps({ modelValue: Boolean, mode: { type: String, required: true }, walletId: { type: String, default: null } });
defineEmits(['update:modelValue', 'verified']);
</script>
