<!--
  What an NWC connection may do, at a glance: Send, Receive, Balance,
  History. A grant the wallet withheld stays visible but struck through, so
  a missing permission is seen before it is missed.
-->
<template>
  <ul class="nwc-caps" :aria-label="$t('This connection can')">
    <li v-for="item in items" :key="item.key" class="nwc-caps__item" :class="{ 'is-off': !item.on }">
      <Icon :icon="item.icon" width="17" height="17" aria-hidden="true" />
      <span>{{ item.label }}</span>
      <span class="sr-only">{{ item.on ? $t('Allowed') : $t('Not allowed') }}</span>
    </li>
  </ul>
</template>

<script setup>
import { computed, getCurrentInstance } from 'vue';

const props = defineProps({
  /** From utils/nwcWallet nwcCapabilities(). */
  capabilities: { type: Object, required: true },
});

const { proxy } = getCurrentInstance();
const items = computed(() => [
  { key: 'send', icon: 'tabler:arrow-up-right', label: proxy.$t('Send'), on: props.capabilities.send },
  { key: 'receive', icon: 'tabler:arrow-down-left', label: proxy.$t('Receive'), on: props.capabilities.receive },
  { key: 'balance', icon: 'tabler:scale', label: proxy.$t('Balance'), on: props.capabilities.balance },
  { key: 'history', icon: 'tabler:list', label: proxy.$t('History'), on: props.capabilities.history },
]);
</script>

<style scoped>
.nwc-caps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.nwc-caps__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: 11px 4px;
  border-radius: 14px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  color: var(--brand-accent-text);
  font: 600 12.5px 'Manrope', sans-serif;
  text-align: center;
}
.nwc-caps__item span:first-of-type {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nwc-caps__item.is-off {
  color: var(--text-muted);
}
.nwc-caps__item.is-off span:first-of-type {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
/* Narrow screens with long words (German "Empfangen"): two by two, never cut. */
@media (max-width: 359px) {
  .nwc-caps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .nwc-caps__item {
    flex-direction: row;
    justify-content: center;
    gap: 6px;
    padding: 10px 6px;
  }
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
