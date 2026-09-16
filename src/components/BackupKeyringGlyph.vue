<template>
  <!-- The keyring as a single-colour silhouette for icon rows and tab bars:
       the same shape people know from the home reminder, painted in
       currentColor so it takes whatever tint its row is showing. -->
  <span class="backup-keyring-glyph" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true"></span>
</template>

<script setup>
defineProps({ size: { type: [Number, String], default: 24 } });
</script>

<style scoped>
.backup-keyring-glyph {
  display: inline-block;
  flex-shrink: 0;
  background-color: currentColor;
  -webkit-mask: url('/icons/backup-keyring.svg') center / contain no-repeat;
  mask: url('/icons/backup-keyring.svg') center / contain no-repeat;
}
</style>
