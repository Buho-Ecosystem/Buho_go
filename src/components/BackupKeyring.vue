<template>
  <img src="/icons/backup-keyring.svg" :width="size" :height="size" alt="" aria-hidden="true" class="backup-keyring" />
</template>

<script setup>
defineProps({ size: { type: [Number, String], default: 28 } });
</script>

<style scoped>
.backup-keyring { display: inline-block; flex-shrink: 0; object-fit: contain; vertical-align: middle; }
</style>
