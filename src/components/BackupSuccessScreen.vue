<template>
  <section class="backup-success" :aria-label="title">
    <div class="backup-success-copy">
      <h1 ref="heading" tabindex="-1">{{ title }}</h1>
    </div>
    <div class="backup-success-mark"><SuccessCheckmark /></div>
    <img class="backup-success-logo" src="/buho_logo.svg" alt="Buho" />
    <footer class="recovery-footer">
      <q-btn unelevated no-caps class="recovery-primary" :label="$t('Done')" @click="$emit('done')" />
    </footer>
  </section>
</template>

<script setup>
import { computed, getCurrentInstance, onMounted, ref } from 'vue';
import SuccessCheckmark from './SuccessCheckmark.vue';
const props = defineProps({ kind: { type: String, required: true } });
const { proxy } = getCurrentInstance();
const title = computed(() => proxy.$t(props.kind === 'wallet' ? 'wosBackup.walletSuccess' : 'wosBackup.identitySuccess'));
defineEmits(['done']);
const heading = ref(null);
onMounted(() => heading.value?.focus());
</script>

<style scoped>
.backup-success { display: flex; flex-direction: column; flex: 1; min-height: 0; text-align: center; background: radial-gradient(ellipse at 50% 55%, var(--brand-accent-soft), transparent 70%); }
.backup-success-copy { padding: max(48px, var(--safe-top, 0px)) 24px 0; }
.backup-success h1 { margin: 0 0 16px; font: 750 clamp(30px, 8vw, 40px)/1.15 'Manrope', sans-serif; letter-spacing: -.04em; outline: none; }
.backup-success-mark { display: grid; place-items: center; flex: 1; min-height: 200px; padding: 36px 0; }
.backup-success-logo { width: 88px; height: 88px; object-fit: contain; margin: 0 auto 24px; }
.backup-success :deep(.success-circle) { background: var(--brand-accent); }
@media (prefers-reduced-motion: reduce) {
  .backup-success :deep(.success-checkmark) { opacity: 1; animation: none; }
  .backup-success :deep(.checkmark-check) { stroke-dashoffset: 0; animation: none; }
  .backup-success :deep(.pulse-ring-once) { display: none; }
}
</style>
