<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    @update:model-value="onDialogModel"
    @show="onShow"
  >
    <q-card
      class="brmail-sheet"
      :class="$q.dark.isActive ? 'brmail-dark' : 'brmail-light'"
      role="dialog"
      :aria-labelledby="titleId"
    >
      <div class="brmail-grabber" aria-hidden="true"><div class="brmail-grabber-bar"></div></div>

      <form class="brmail-body" novalidate @submit.prevent="onSubmit">
        <div class="brmail-tile" aria-hidden="true">
          <img src="/Bitrefill/bitrefill-mark.png" alt="" />
        </div>
        <h2 :id="titleId" class="brmail-title">{{ $t('Where should vouchers go?') }}</h2>
        <p class="brmail-lead">{{ $t('Bitrefill emails every voucher and receipt. Enter your address once and BuhoGO fills it in when you shop.') }}</p>

        <label class="brmail-label" :for="inputId">{{ $t('Email') }}</label>
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
          :aria-describedby="showError ? errorId : undefined"
        >
        <p v-if="showError" :id="errorId" class="brmail-error" role="alert">{{ $t('Enter a valid email address.') }}</p>

        <ul class="brmail-notes">
          <li>
            <Icon icon="tabler:mail" width="18" height="18" aria-hidden="true" />
            <span>{{ $t('Vouchers also arrive in this inbox. Anyone who can read it can open them.') }}</span>
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
          :label="editing ? $t('Save') : $t('Continue')"
        />
        <button v-if="editing && hasSaved" type="button" class="brmail-secondary brmail-secondary--destructive" @click="$emit('remove')">
          {{ $t('Remove email') }}
        </button>
        <button v-else-if="!editing" type="button" class="brmail-secondary" @click="$emit('skip')">
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
 * Asks once where Bitrefill should send vouchers, before the first visit to
 * the shop. The address is only a convenience: "Not now" leaves it to
 * Bitrefill's own checkout. Opened again from the shop's header to change or
 * remove it. Says plainly that vouchers land in that inbox too.
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
    showError() { return this.submitted && !isValidEmail(this.email); },
  },
  methods: {
    onShow() {
      this.email = this.initialEmail || '';
      this.submitted = false;
    },
    onDialogModel(value) {
      this.$emit('update:modelValue', value);
      // Swiping the sheet away on first open means "Not now", like the button.
      if (!value && !this.editing) this.$emit('skip');
    },
    onSubmit() {
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
  border-radius: 20px 20px 0 0;
  padding-bottom: max(16px, var(--safe-bottom, 0px));
  font-family: 'Manrope', sans-serif;
}
.brmail-light { background: #ffffff; color: #1a1a1a; }
.brmail-dark { background: #1e1e1e; color: #f0f0f0; }

.brmail-grabber { display: flex; justify-content: center; padding-top: 8px; }
.brmail-grabber-bar { width: 36px; height: 4px; border-radius: 2px; background: rgba(128, 128, 128, 0.35); }

.brmail-body { display: flex; flex-direction: column; padding: 12px 20px 8px; }

.brmail-tile {
  width: 56px; height: 56px; margin: 4px auto 12px;
  border-radius: 14px; overflow: hidden;
}
.brmail-tile img { width: 100%; height: 100%; display: block; }

.brmail-title { margin: 0; text-align: center; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; }
.brmail-lead { margin: 8px 0 20px; text-align: center; font-size: 15px; line-height: 1.45; opacity: 0.72; }

.brmail-label { font-size: 13px; font-weight: 600; margin: 0 0 6px 4px; opacity: 0.72; }
.brmail-input {
  width: 100%; min-height: 48px; padding: 0 14px;
  border-radius: 12px; border: 1px solid transparent; outline: none;
  font: 500 16px 'Manrope', sans-serif;
}
.brmail-light .brmail-input { background: #f2f2f4; color: #1a1a1a; }
.brmail-dark .brmail-input { background: #2a2a2a; color: #f5f5f5; }
.brmail-input:focus-visible { border-color: var(--brand-accent-text, #15DE72); }
.brmail-input[aria-invalid='true'] { border-color: #ff453a; }
.brmail-error { margin: 6px 4px 0; font-size: 13px; color: #ff453a; }

.brmail-notes { list-style: none; margin: 18px 0 20px; padding: 0; display: grid; gap: 12px; }
.brmail-notes li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.45; }
.brmail-notes li span { opacity: 0.8; }
.brmail-notes :deep(svg) { flex: none; margin-top: 1px; color: var(--brand-accent-text, #15DE72); }

.brmail-primary { min-height: 50px; border-radius: 14px; font-size: 16px; font-weight: 700; }

.brmail-secondary {
  margin-top: 6px; min-height: 44px;
  border: 0; background: none; cursor: pointer;
  font: 600 15px 'Manrope', sans-serif;
  color: var(--brand-accent-text, #15DE72);
}
.brmail-secondary--destructive { color: #ff453a; }
.brmail-secondary:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 8px; }
</style>
