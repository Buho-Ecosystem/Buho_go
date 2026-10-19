<!--
  BrantaChangedCode

  Stops a payment whose code was changed: Branta found that the address
  shown in the code is not the one the business registered. Fills the
  confirm sheet in place of the amount and the commit control, names no
  business (the code cannot be trusted to say who it is) and offers no way
  to send.
-->
<template>
  <div class="changed-code" role="alert">
    <span class="changed-code-mark" aria-hidden="true">
      <Icon icon="tabler:shield-x" width="30" height="30" />
    </span>
    <h3>{{ $t('This code was changed') }}</h3>
    <p class="changed-code-body">{{ $t('The address in it is not the one the business registered with Branta. Sending could pay someone else.') }}</p>
    <p class="changed-code-note">{{ $t('Nothing was sent. Ask the business for a new code.') }}</p>
    <button type="button" class="changed-code-close" @click="$emit('close')">{{ $t('Close') }}</button>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'

export default {
  name: 'BrantaChangedCode',
  components: { Icon },
  emits: ['close'],
}
</script>

<style scoped>
.changed-code {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 12px 20px 8px;
  text-align: center;
  font-family: 'Manrope', sans-serif;
}

.changed-code-mark {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: rgba(220, 38, 38, 0.1);
  color: #B42318;
}

body.body--dark .changed-code-mark {
  background: rgba(248, 113, 113, 0.14);
  color: #FCA5A5;
}

.changed-code h3 {
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.changed-code-body {
  margin: 0;
  max-width: 32ch;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-primary);
}

.changed-code-note {
  margin: 0;
  max-width: 34ch;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.changed-code-close {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  height: 52px;
  margin-top: 16px;
  border-radius: 26px;
  display: grid;
  place-items: center;
  background: var(--text-primary);
  color: var(--bg-primary, #fff);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.changed-code-close:focus-visible {
  outline: 2px solid var(--brand-accent, #059573);
  outline-offset: 2px;
}
</style>
