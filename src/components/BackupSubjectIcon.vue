<template>
  <!-- Subject silhouettes are bundled SVGs so recovery remains recognizable offline.
       Adjacent text names the subject; the decorative icon must not repeat it. -->
  <svg class="backup-subject-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <template v-if="kind === 'identity'">
      <circle cx="12" cy="7" r="4" />
      <path d="M4.5 20c0-4.2 2.9-7 7.5-7s7.5 2.8 7.5 7c0 .6-.4 1-1 1h-13c-.6 0-1-.4-1-1Z" />
    </template>
    <path v-else fill-rule="evenodd" d="M5 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3H5a1 1 0 1 1 0-2h13a1 1 0 0 0 0-2H5v1Zm12 8a2.5 2.5 0 0 0 0 5h3v-5h-3Zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" clip-rule="evenodd" />
  </svg>
</template>

<script setup>
defineProps({
  kind: { type: String, required: true, validator: value => ['wallet', 'identity'].includes(value) },
  size: { type: [Number, String], default: 24 },
});
</script>

<style scoped>
.backup-subject-icon { display: inline-block; flex-shrink: 0; vertical-align: middle; }
</style>
