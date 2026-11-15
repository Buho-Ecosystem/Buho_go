<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    :persistent="busy"
    transition-show="slide-up"
    transition-hide="slide-down"
    :aria-labelledby="titleId"
    @update:model-value="onDialogModel"
  >
    <q-card class="brmail-sheet">
      <div class="brmail-grabber" aria-hidden="true"><div class="brmail-grabber-bar"></div></div>

      <form class="brmail-body" novalidate @submit.prevent="onSubmit">
        <div class="brmail-tile" aria-hidden="true">
          <img src="/Bitrefill/bitrefill-mark.png" alt="" />
        </div>
        <h2 :id="titleId" class="brmail-title">{{ $t('Email for your vouchers') }}</h2>
        <p :id="leadId" class="brmail-lead">{{ $t('Bitrefill sends every voucher you buy to this address, together with its receipt. Use an inbox you can open.') }}</p>

        <label class="brmail-label" :for="inputId">{{ $t('Send vouchers to') }}</label>
        <input
          :id="inputId"
          ref="input"
          v-model="email"
          class="brmail-input"
          type="email"
          inputmode="email"
          autocomplete="email"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="done"
          maxlength="254"
          placeholder="you@example.com"
          :aria-invalid="showError ? 'true' : 'false'"
          :aria-describedby="describedBy"
        >
        <p v-if="showError" :id="errorId" class="brmail-error" role="alert">{{ $t('Enter a valid email address.') }}</p>
        <!-- Changing it mid-visit: say what it does and does not change. -->
        <p v-if="editing" :id="effectId" class="brmail-effect">{{ $t('Applies to your next order. The shop reloads when you save.') }}</p>

        <ul class="brmail-notes">
          <li>
            <Icon icon="tabler:mail" width="18" height="18" aria-hidden="true" />
            <span>{{ $t('Anyone who can read this inbox can open your vouchers.') }}</span>
          </li>
          <li>
            <Icon icon="tabler:lock" width="18" height="18" aria-hidden="true" />
            <span>{{ $t('Kept encrypted on this phone. Only Bitrefill receives it, when you shop.') }}</span>
          </li>
        </ul>

        <q-btn
          type="submit"
          unelevated
          no-caps
          class="brmail-primary full-width"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :loading="busy"
          :disable="busy || !email.trim()"
          :label="editing ? $t('Save') : $t('Use this email')"
        />
        <button v-if="editing && hasSaved" type="button" class="brmail-secondary brmail-secondary--destructive" :disabled="busy" @click="$emit('remove')">
          {{ $t('Remove email') }}
        </button>
        <button v-else-if="!editing" type="button" class="brmail-secondary" :disabled="busy" @click="$emit('skip')">
          {{ $t('Not now') }}
        </button>
      </form>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { isValidEmail } from '../../services/bitrefill/widget.js';

/**
 * Asks once for the email Bitrefill sends vouchers to, before the first visit
 * to the shop. The title, the field's label and the button all say that this
 * address receives the vouchers. "Not now" leaves the email to Bitrefill's
 * own checkout. Opened again from the shop's header to change or remove it:
 * then it says that the change applies to the next order and reloads the
 * shop, and the page asks before removing (`remove` is a request, not done).
 *
 * UI only: the shop page stores the address (encrypted) on `save`.
 */
export default {
  name: 'BitrefillEmailSheet',
  components: { Icon },
  props: {
    modelValue: { type: Boolean, required: true },
    /** The saved address, or a suggestion (the backup account's email). */
    initialEmail: { type: String, default: '' },
    /** Opened from the header: Save / Remove instead of Continue / Not now. */
    editing: { type: Boolean, default: false },
    /** An address is saved, so it can be removed. */
    hasSaved: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'save', 'skip', 'remove'],
  data() {
    return { email: '', submitted: false };
  },
  computed: {
    titleId() { return `brmail-title-${this.$.uid}`; },
    inputId() { return `brmail-input-${this.$.uid}`; },
    errorId() { return `brmail-error-${this.$.uid}`; },
    leadId() { return `brmail-lead-${this.$.uid}`; },
    effectId() { return `brmail-effect-${this.$.uid}`; },
    describedBy() {
      return [this.showError ? this.errorId : '', this.leadId, this.editing ? this.effectId : ''].filter(Boolean).join(' ');
    },
    showError() { return this.submitted && !isValidEmail(this.email); },
  },
  watch: {
    modelValue: {
      immediate: true,
      handler(open) {
        if (!open) return;
        // Initialize before the opening animation; its end must not erase typing.
        this.email = this.initialEmail || '';
        this.submitted = false;
      },
    },
  },
  methods: {
    onDialogModel(value) {
      if (this.busy) return;
      this.$emit('update:modelValue', value);
      // Swiping the sheet away on first open means "Not now", like the button.
      if (!value && !this.editing) this.$emit('skip');
    },
    onSubmit() {
      if (this.busy) return;
      this.submitted = true;
      if (!isValidEmail(this.email)) {
        this.$refs.input?.focus();
        return;
      }
      this.$emit('save', this.email.trim());
    },
  },
};
</script>

<style scoped>
.brmail-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding-bottom: max(16px, var(--safe-bottom, 0px));
  font-family: 'Manrope', sans-serif;
  background: var(--bg-card);
  color: var(--text-primary);
}

.brmail-grabber { display: flex; justify-content: center; padding-top: 8px; }
.brmail-grabber-bar { width: 36px; height: 4px; border-radius: 2px; background: var(--text-muted); opacity: 0.5; }

.brmail-body { display: flex; flex-direction: column; padding: 12px 20px 8px; }

.brmail-tile {
  width: 56px; height: 56px; margin: 4px auto 12px;
  border-radius: 14px; overflow: hidden;
}
.brmail-tile img { width: 100%; height: 100%; display: block; }

.brmail-title { margin: 0; text-align: center; font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; }
.brmail-lead { margin: 8px 0 20px; text-align: center; font-size: 0.9375rem; line-height: 1.45; color: var(--text-secondary); }

.brmail-label { font-size: 0.8125rem; font-weight: 600; margin: 0 0 6px 4px; color: var(--text-secondary); }
/* 1rem at least: a smaller field makes iOS zoom the page on focus. */
.brmail-input {
  width: 100%; min-height: 48px; padding: 0 14px;
  border-radius: var(--radius-ms); border: 1px solid transparent; outline: none;
  font: 500 1rem 'Manrope', sans-serif;
  background: var(--bg-input);
  color: var(--text-primary);
}
.brmail-input:focus-visible { border-color: var(--brand-accent-text); }
.brmail-input[aria-invalid='true'] { border-color: var(--color-negative); }
.brmail-error { margin: 6px 4px 0; font-size: 0.8125rem; color: var(--color-negative); }
.brmail-effect { margin: 8px 4px 0; font-size: 0.8125rem; line-height: 1.45; color: var(--text-secondary); }

.brmail-notes { list-style: none; margin: 18px 0 20px; padding: 0; display: grid; gap: 12px; }
.brmail-notes li { display: flex; gap: 10px; align-items: flex-start; font-size: 0.875rem; line-height: 1.45; }
.brmail-notes li span { color: var(--text-secondary); }
.brmail-notes :deep(svg) { flex: none; margin-top: 1px; color: var(--brand-accent-text); }

.brmail-primary { min-height: 50px; border-radius: 14px; font-size: 1rem; font-weight: 700; }

.brmail-secondary {
  margin-top: 6px; min-height: 44px;
  border: 0; background: none; cursor: pointer;
  font: 600 0.9375rem 'Manrope', sans-serif;
  color: var(--brand-accent-text);
}
.brmail-secondary--destructive { color: var(--color-negative); }
.brmail-secondary:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: var(--radius-sm); }
</style>
