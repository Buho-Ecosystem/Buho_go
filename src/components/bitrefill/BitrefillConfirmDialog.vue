<template>
  <q-dialog v-model="open" :aria-labelledby="titleId" :aria-describedby="messageId">
    <q-card class="brconfirm">
      <h2 :id="titleId">{{ title }}</h2>
      <p :id="messageId">{{ message }}</p>
      <div class="brconfirm-actions">
        <button type="button" class="brconfirm-primary" :class="{ 'brconfirm-primary--destructive': destructive }" @click="$emit('confirm')">{{ confirmLabel }}</button>
        <button type="button" class="brconfirm-secondary" @click="$emit('cancel')">{{ cancelLabel }}</button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
/**
 * One question with two answers, for the shop's two moments that lose
 * something: leaving while an order is on screen or unresolved, and removing
 * the voucher email. Dismissing it is the safe answer (`cancel`).
 *
 * UI only: the shop page decides what each answer does.
 */
export default {
  name: 'BitrefillConfirmDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    confirmLabel: { type: String, required: true },
    cancelLabel: { type: String, required: true },
    /** The confirming answer removes something. */
    destructive: { type: Boolean, default: false },
  },
  emits: ['confirm', 'cancel'],
  computed: {
    titleId() { return `brconfirm-title-${this.$.uid}`; },
    messageId() { return `brconfirm-message-${this.$.uid}`; },
    open: {
      get() { return this.modelValue; },
      set(value) { if (!value) this.$emit('cancel'); },
    },
  },
};
</script>

<style scoped>
.brconfirm {
  width: 340px;
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 24px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  color: var(--text-primary);
  text-align: center;
}
h2 { margin: 0; font: 700 1.25rem/1.35 'Manrope', sans-serif; overflow-wrap: anywhere; }
p { margin: 12px 0 0; font: 400 0.9375rem/1.55 'Manrope', sans-serif; color: var(--text-secondary); overflow-wrap: anywhere; }
.brconfirm-actions { display: grid; gap: 8px; margin-top: 24px; }
button {
  width: 100%;
  min-height: 48px;
  padding: 12px;
  border: 0;
  border-radius: var(--radius-md);
  font: 600 1rem/1.5 'Manrope', sans-serif;
  overflow-wrap: anywhere;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 3px; }
.brconfirm-primary { background: var(--brand-accent); color: var(--bg-card); font-weight: 700; }
.brconfirm-primary--destructive { background: transparent; color: var(--color-negative); }
.brconfirm-secondary { background: transparent; color: var(--text-secondary); font-weight: 400; }
/* When confirming loses something, staying put is the answer that stands out. */
.brconfirm-primary--destructive + .brconfirm-secondary { background: var(--bg-input); color: var(--text-primary); font-weight: 600; }
</style>
