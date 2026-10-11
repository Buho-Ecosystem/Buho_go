<!--
  One identity in the Identities list.

  Two targets, side by side, never nested: the row itself makes this the
  identity in use, and the trailing detail button (ⓘ) opens the identity's
  own page, where its keys and removal live. The identity in use carries a
  checkmark instead of a tap target, since choosing it again does nothing.
-->
<template>
  <div class="acct-row">
    <component
      :is="active ? 'div' : 'button'"
      :type="active ? null : 'button'"
      class="acct-main"
      :class="{ 'acct-main--static': active }"
      :disabled="active ? null : disabled"
      @click="active ? null : emit('select')"
    >
      <span class="acct-avatar" aria-hidden="true">
        <img v-if="picture && !pictureBroken" :src="picture" alt="" @error="pictureBroken = true" />
        <Icon v-else icon="tabler:user" width="20" height="20" />
      </span>
      <span class="acct-text">
        <span class="acct-name">{{ name }}</span>
        <span v-if="caption" class="acct-caption" :class="{ 'acct-caption--mono': mono }">{{ caption }}</span>
      </span>
    </component>

    <!-- Iconify hides its SVGs from assistive tech, so the label sits on a wrapper. -->
    <span v-if="active" class="acct-state" role="img" :aria-label="t('In use')">
      <Icon icon="tabler:check" width="22" height="22" />
    </span>

    <button type="button" class="acct-info" :aria-label="t('Details for {name}', { name })" @click="emit('details')">
      <Icon icon="tabler:info-circle" width="22" height="22" />
    </button>
  </div>
</template>

<script setup>
import { getCurrentInstance, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';

const props = defineProps({
  name: { type: String, required: true },
  caption: { type: String, default: '' },
  /** The caption is a value (a public code), not words. */
  mono: { type: Boolean, default: false },
  picture: { type: String, default: '' },
  active: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['select', 'details']);

// vue-i18n runs in legacy mode, so useI18n() throws; reach $t via the proxy.
const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);

const pictureBroken = ref(false);
watch(() => props.picture, () => { pictureBroken.value = false; });
</script>

<style scoped>
.acct-row { display: flex; align-items: center; min-height: 64px; padding-left: 14px; }
.acct-row + .acct-row { border-top: 1px solid var(--border-card); }
.acct-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 10px 0; border: 0; background: transparent; color: var(--text-primary); font-family: 'Manrope', sans-serif; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.acct-main--static { cursor: default; }
.acct-main:disabled { opacity: 0.5; cursor: default; }
.acct-main:not(.acct-main--static):not(:disabled):active { opacity: 0.6; }
.acct-avatar { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: var(--bg-input); color: var(--text-secondary); }
.acct-avatar img { width: 100%; height: 100%; object-fit: cover; }
.acct-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.acct-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 600; letter-spacing: -0.012em; }
.acct-caption { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: 13px; }
.acct-caption--mono { font-family: var(--font-mono); font-size: 12px; }
.acct-state { flex: 0 0 auto; display: grid; place-items: center; margin-left: 8px; color: var(--brand-accent-text); }
.acct-info { width: 48px; height: 48px; flex: 0 0 auto; margin-right: 2px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--brand-accent-text); cursor: pointer; }
.acct-main:focus-visible, .acct-info:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
</style>
