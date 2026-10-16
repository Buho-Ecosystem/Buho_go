<!--
  LNBitsAddressStep: give this LNbits wallet a Lightning address.

  Two modes, chosen from what the server already has:
    • pick   — addresses with a username exist: one list with a check per
               address and "New address" as its last row.
    • create — a single field that already shows the whole address: the
               name grows in place and the "@domain" follows it, so the
               field is its own preview. The optional thank-you message
               (LUD-09 success_text) is one row that opens on tap.

  UI only: the caller passes `createAddress` (bound to its own provider)
  and stores the result on `confirm`.
-->
<template>
  <LNBitsStep
    :title="$t('Lightning address')"
    :subtitle="mode === 'pick' ? $t('Pick one for this wallet.') : $t('Get paid by name, like email.')"
    :back="back"
    :skip-label="skipLabel"
    @back="$emit('back')"
    @skip="$emit('skip')"
  >
    <template #icon>
      <Icon icon="tabler:at" width="26" height="26" />
    </template>

    <div v-if="mode === 'pick'" class="iform-group" role="radiogroup" :aria-label="$t('Lightning address')">
      <button
        v-for="item in existingAddresses"
        :key="item.id"
        type="button"
        role="radio"
        class="ln-row"
        :aria-checked="selectedId === item.id"
        @click="selectedId = item.id"
      >
        <span class="ln-radio" :class="{ 'is-on': selectedId === item.id }" aria-hidden="true">
          <Icon v-if="selectedId === item.id" icon="tabler:check" width="12" height="12" />
        </span>
        <span class="ln-address">
          <span class="ln-address__user">{{ userOf(item) }}</span><span class="ln-address__domain">@{{ domainOf(item) }}</span>
        </span>
      </button>
      <button type="button" class="ln-row ln-row--accent" @click="switchToCreate">
        <span class="ln-radio ln-radio--plain" aria-hidden="true"><Icon icon="tabler:plus" width="16" height="16" /></span>
        <span>{{ $t('New address') }}</span>
      </button>
    </div>

    <template v-else>
      <div class="iform-group">
        <div class="iform-row">
          <label class="iform-label" :for="inputId">{{ $t('Your address') }}</label>
          <div class="ln-field">
            <!-- The input sizes itself to its text, so the domain follows the name. -->
            <span class="ln-field__grow" :data-value="newUsername || $t('yourname')">
              <input
                :id="inputId"
                v-model="newUsername"
                class="ln-field__user"
                size="1"
                :placeholder="$t('yourname')"
                autocapitalize="off"
                autocomplete="off"
                spellcheck="false"
                maxlength="32"
                :aria-invalid="!!inputError"
                @keyup.enter="onConfirm"
              >
            </span>
            <span class="ln-field__domain">@{{ domain }}</span>
          </div>
        </div>
        <div v-if="showMessage" class="iform-row">
          <label class="iform-label" :for="messageId">{{ $t('Thank-you message') }}</label>
          <input
            :id="messageId"
            ref="message"
            v-model="successText"
            class="ln-field__message"
            maxlength="144"
            :placeholder="$t('Shown right after someone pays you')"
          >
        </div>
        <button v-else type="button" class="ln-row" @click="openMessage">
          <span class="ln-row__tile" aria-hidden="true"><Icon icon="tabler:message-2" width="16" height="16" /></span>
          <span class="ln-row__text">{{ $t('Thank-you message') }}<small>{{ $t('Optional') }}</small></span>
          <Icon icon="tabler:chevron-right" width="16" height="16" class="ln-row__chevron" aria-hidden="true" />
        </button>
      </div>
      <p v-if="inputError || createError" class="ln-error" role="alert">{{ inputError || createError }}</p>
      <button v-if="existingAddresses.length" type="button" class="ln-link" @click="mode = 'pick'">
        {{ $t('Use an existing address') }}
      </button>
    </template>

    <template #footer>
      <q-btn
        class="iform-connect full-width"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :loading="busy"
        :disable="!canConfirm || busy"
        no-caps
        unelevated
        @click="onConfirm"
      >{{ mode === 'pick' ? $t('Use address') : $t('Create address') }}</q-btn>
    </template>
  </LNBitsStep>
</template>

<script>
import LNBitsStep from './LNBitsStep.vue';
import { isValidUsername, splitAddress, suggestUsername } from '../../utils/lnbitsAddress.js';

export default {
  name: 'LNBitsAddressStep',
  components: { LNBitsStep },
  props: {
    /** Hostname for the "@domain" part, e.g. "legend.lnbits.com". */
    domain: { type: String, required: true },
    /** Addresses already on the server: [{ id, username, address }]. */
    existingAddresses: { type: Array, default: () => [] },
    defaultUsername: { type: String, default: '' },
    /**
     * Creates the address on the server:
     * (username, { successText }) => Promise<{ address }>.
     */
    createAddress: { type: Function, required: true },
    skipLabel: { type: String, default: '' },
    back: { type: Boolean, default: false },
  },
  emits: ['confirm', 'skip', 'back'],
  data() {
    return {
      mode: this.existingAddresses.length ? 'pick' : 'create',
      selectedId: this.existingAddresses[0]?.id || null,
      newUsername: suggestUsername(this.defaultUsername),
      showMessage: false,
      successText: '',
      inputError: '',
      createError: '',
      busy: false,
    };
  },
  computed: {
    inputId() { return `lnbits-address-${this.$.uid}`; },
    messageId() { return `lnbits-message-${this.$.uid}`; },
    selected() {
      return this.existingAddresses.find((a) => a.id === this.selectedId) || null;
    },
    canConfirm() {
      return this.mode === 'pick' ? !!this.selected : isValidUsername(this.newUsername);
    },
  },
  watch: {
    newUsername(value) {
      // Lowercase as typed: LNbits stores usernames lowercase anyway.
      const lower = value.toLowerCase();
      if (lower !== value) {
        this.newUsername = lower;
        return;
      }
      this.createError = '';
      this.inputError = !value || isValidUsername(value)
        ? ''
        : this.$t('Use lowercase letters, numbers, dots, hyphens or underscore.');
    },
  },
  methods: {
    userOf(item) {
      return splitAddress(item.address, this.domain).user;
    },
    domainOf(item) {
      return splitAddress(item.address, this.domain).domain;
    },
    switchToCreate() {
      this.mode = 'create';
      this.createError = '';
      if (!this.newUsername) this.newUsername = suggestUsername(this.defaultUsername);
    },
    openMessage() {
      this.showMessage = true;
      this.$nextTick(() => this.$refs.message?.focus());
    },
    async onConfirm() {
      if (!this.canConfirm || this.busy) return;
      if (this.mode === 'pick') {
        this.$emit('confirm', { address: this.selected.address, isNew: false });
        return;
      }
      this.busy = true;
      this.createError = '';
      try {
        const result = await this.createAddress(this.newUsername, { successText: this.successText.trim() });
        if (!result?.address) throw new Error(this.$t('Something went wrong. Please try again.'));
        this.$emit('confirm', { address: result.address, isNew: true });
      } catch (err) {
        const message = err?.message || '';
        this.createError = /already|exists|taken|unique/i.test(message)
          ? this.$t('That name is already taken. Try another.')
          : message || this.$t('Could not create address.');
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style scoped>
.ln-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 14px;
  border: 0;
  background: none;
  color: var(--text-primary);
  font: 600 15px 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
}
.iform-row + .ln-row,
.ln-row + .ln-row,
.ln-row + .iform-row {
  border-top: 1px solid var(--border-card);
}
.ln-row--accent {
  color: var(--brand-accent-text);
}
.ln-row:focus-visible,
.ln-link:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: -2px;
  border-radius: 12px;
}
.ln-radio {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--border-card);
  display: grid;
  place-items: center;
}
.ln-radio.is-on {
  border-color: var(--brand-accent);
  background: var(--brand-accent);
  color: var(--bg-card);
}
.ln-radio--plain {
  border: 0;
}
.ln-address {
  flex: 1;
  min-width: 0;
  display: flex;
  white-space: nowrap;
  overflow: hidden;
}
.ln-address__user {
  flex-shrink: 0;
}
.ln-address__domain {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--text-muted);
}

.ln-field {
  display: flex;
  align-items: center;
  min-height: 30px;
  min-width: 0;
  font: 600 15px/1.4 'Manrope', sans-serif;
}
.ln-field__grow {
  display: inline-grid;
  flex-shrink: 0;
  max-width: 65%;
}
.ln-field__grow::after {
  content: attr(data-value) ' ';
  grid-area: 1 / 1;
  visibility: hidden;
  white-space: pre;
  font: inherit;
}
.ln-field__user {
  grid-area: 1 / 1;
  width: 100%;
  min-width: 1ch;
  border: 0;
  outline: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--text-primary);
}
.ln-field__user::placeholder,
.ln-field__message::placeholder {
  color: var(--text-muted);
}
.ln-field__domain {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--text-muted);
}
.ln-field__message {
  width: 100%;
  min-height: 30px;
  border: 0;
  outline: none;
  background: none;
  padding: 0;
  font: 500 15px/1.4 'Manrope', sans-serif;
  color: var(--text-primary);
}

.ln-row__tile {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: var(--bg-card);
  color: var(--text-secondary);
}
.ln-row__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ln-row__text small {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-secondary);
}
.ln-row__chevron {
  flex-shrink: 0;
  color: var(--text-muted);
}

.ln-error {
  margin: 10px 4px 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--color-negative);
}
.ln-link {
  display: block;
  margin: 14px auto 0;
  min-height: 40px;
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 14px 'Manrope', sans-serif;
  cursor: pointer;
}
</style>
