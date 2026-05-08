<!--
  LNBitsLightningAddressDialog
  ----------------------------
  Post-connect prompt that invites the user to attach a lightning address to
  their freshly-added LNBits wallet.

  Two modes, chosen automatically based on what the server already has:
    • "pick"   — server already has addresses with usernames → user picks one
                 (or jumps to "create" for a new one).
    • "create" — no existing addresses, or user chose to add another → free-form
                 username input with live `user@domain` preview.

  The dialog owns its own UI state but delegates the actual API call back to the
  caller via the `createAddress` prop. This keeps the component UI-only and lets
  the caller decide which provider / wallet the creation runs against.

  Events:
    • update:modelValue  — v-model plumbing for show/hide
    • confirm            — { address, isNew } — user chose an address
    • skip               — user dismissed without setting an address

  Styling uses the shared theme tokens (--bg-card, --text-primary, etc.) so the
  dialog automatically follows light/dark mode without per-element ternaries.
-->
<template>
  <q-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    persistent
  >
    <q-card class="ln-addr-dialog">
      <!-- Header -->
      <div class="ln-addr-header">
        <div class="ln-addr-header-icon">
          <Icon icon="tabler:at" width="22" height="22" />
        </div>
        <div class="ln-addr-header-text">
          <div class="ln-addr-title">{{ $t('Get a Lightning Address') }}</div>
          <div class="ln-addr-subtitle">
            {{ $t('A simple name like email, so anyone can send you sats.') }}
          </div>
        </div>
      </div>

      <!-- Body: pick from existing -->
      <div v-if="mode === 'pick'" class="ln-addr-body">
        <div class="ln-addr-hint">
          {{ $t('We found addresses on your wallet. Pick one to use, or add another.') }}
        </div>

        <q-list class="ln-addr-list">
          <q-item
            v-for="item in existingAddresses"
            :key="item.id"
            clickable
            v-ripple
            class="ln-addr-item"
            :class="{ 'ln-addr-item-selected': selectedId === item.id }"
            @click="selectedId = item.id"
          >
            <q-item-section avatar>
              <div class="ln-addr-item-icon">
                <Icon icon="tabler:at" width="16" height="16" />
              </div>
            </q-item-section>
            <q-item-section>
              <q-item-label class="ln-addr-item-label">{{ item.address }}</q-item-label>
            </q-item-section>
            <q-item-section side v-if="selectedId === item.id">
              <Icon icon="tabler:check" width="18" height="18" class="ln-addr-check" />
            </q-item-section>
          </q-item>
        </q-list>

        <button type="button" class="ln-addr-link" @click="switchToCreate">
          <Icon icon="tabler:plus" width="14" height="14" />
          {{ $t('Create a new one') }}
        </button>
      </div>

      <!-- Body: create new -->
      <div v-else class="ln-addr-body">
        <div class="ln-addr-hint">
          {{ $t('Pick a short name. You can change it later in your LNBits wallet.') }}
        </div>

        <q-input
          v-model="newUsername"
          :placeholder="$t('yourname')"
          borderless
          dense
          autofocus
          class="ln-addr-input"
          input-class="ln-addr-input-inner"
          :error="!!inputError"
          :error-message="inputError"
          hide-bottom-space
          @keyup.enter="onConfirm"
        >
          <template #append>
            <span class="ln-addr-domain">@{{ domain }}</span>
          </template>
        </q-input>

        <div v-if="previewAddress" class="ln-addr-preview">
          {{ $t('Your address will be') }}
          <strong>{{ previewAddress }}</strong>
        </div>

        <div v-if="createError" class="ln-addr-error">
          {{ createError }}
        </div>

        <button
          v-if="existingAddresses.length > 0"
          type="button"
          class="ln-addr-link"
          @click="mode = 'pick'"
        >
          <Icon icon="tabler:arrow-left" width="14" height="14" />
          {{ $t('Back to my addresses') }}
        </button>
      </div>

      <!-- Actions -->
      <div class="ln-addr-actions">
        <q-btn
          flat
          no-caps
          :label="$t('Not now')"
          class="ln-addr-skip-btn"
          :disable="busy"
          @click="onSkip"
        />
        <q-btn
          unelevated
          no-caps
          class="ln-addr-confirm-btn"
          :label="confirmLabel"
          :loading="busy"
          :disable="!canConfirm || busy"
          @click="onConfirm"
        />
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
// `Icon` is registered globally via src/boot/iconify.js, so no local import needed.

// Allowed characters in an LNBits lnurlp username.
// Mirrors the typical LNBits server-side regex; we validate client-side to give
// friendly feedback before round-tripping to the server.
const USERNAME_PATTERN = /^[a-z0-9_.-]{1,32}$/;

export default {
  name: 'LNBitsLightningAddressDialog',

  props: {
    modelValue: { type: Boolean, required: true },

    // Hostname used as the `@domain` part, e.g. "mylnbits.com"
    domain: { type: String, required: true },

    // Addresses already on the server — shape: [{ id, username, address, min, max }]
    existingAddresses: { type: Array, default: () => [] },

    // Used to pre-fill the "create" input with a sensible suggestion
    defaultUsername: { type: String, default: '' },

    // Async callback that creates the address on the server.
    // Signature: (username: string) => Promise<{ address: string, id?: string, username?: string }>
    createAddress: { type: Function, required: true },
  },

  emits: ['update:modelValue', 'confirm', 'skip'],

  data() {
    return {
      // 'pick' when the user should choose from existingAddresses, 'create' for a new one
      mode: this.existingAddresses.length > 0 ? 'pick' : 'create',
      // Selected id in pick mode; defaults to the first existing address so "Use this" works immediately
      selectedId: this.existingAddresses[0]?.id || null,
      // Free-form input in create mode
      newUsername: this.sanitizeUsername(this.defaultUsername),
      // Inline validation error (client-side)
      inputError: '',
      // Error returned by the server (e.g. "username already taken")
      createError: '',
      // Spinner while the createAddress promise is pending
      busy: false,
    };
  },

  computed: {
    selectedExisting() {
      if (!this.selectedId) return null;
      return this.existingAddresses.find((a) => a.id === this.selectedId) || null;
    },

    previewAddress() {
      const u = (this.newUsername || '').trim().toLowerCase();
      return u ? `${u}@${this.domain}` : '';
    },

    canConfirm() {
      if (this.mode === 'pick') return !!this.selectedExisting;
      return this.isUsernameValid(this.newUsername);
    },

    confirmLabel() {
      return this.mode === 'pick'
        ? this.$t('Use this address')
        : this.$t('Create address');
    },
  },

  watch: {
    // Reset transient state each time the dialog opens so stale errors don't
    // leak across invocations.
    modelValue(isOpen) {
      if (!isOpen) return;
      this.mode = this.existingAddresses.length > 0 ? 'pick' : 'create';
      this.selectedId = this.existingAddresses[0]?.id || null;
      this.newUsername = this.sanitizeUsername(this.defaultUsername);
      this.inputError = '';
      this.createError = '';
      this.busy = false;
    },

    newUsername() {
      // Clear server error as soon as the user edits the field.
      this.createError = '';
      if (!this.newUsername) {
        this.inputError = '';
        return;
      }
      this.inputError = this.isUsernameValid(this.newUsername)
        ? ''
        : this.$t('Use lowercase letters, numbers, dots, hyphens or underscore.');
    },
  },

  methods: {
    sanitizeUsername(raw) {
      // Best-effort suggestion: strip whitespace, lowercase, drop illegal chars.
      // Leaves the user free to edit — we never force-submit a suggestion.
      if (!raw) return '';
      return String(raw)
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9_.-]/g, '')
        .slice(0, 32);
    },

    isUsernameValid(value) {
      return USERNAME_PATTERN.test((value || '').trim().toLowerCase());
    },

    switchToCreate() {
      this.mode = 'create';
      if (!this.newUsername) {
        this.newUsername = this.sanitizeUsername(this.defaultUsername);
      }
      this.createError = '';
    },

    onSkip() {
      this.$emit('skip');
      this.$emit('update:modelValue', false);
    },

    async onConfirm() {
      if (!this.canConfirm || this.busy) return;

      if (this.mode === 'pick') {
        this.$emit('confirm', { address: this.selectedExisting.address, isNew: false });
        this.$emit('update:modelValue', false);
        return;
      }

      // Create mode — delegate to the parent-provided callback.
      this.busy = true;
      this.createError = '';
      try {
        const username = this.newUsername.trim().toLowerCase();
        const result = await this.createAddress(username);
        if (!result || !result.address) {
          throw new Error(this.$t('Something went wrong. Please try again.'));
        }
        this.$emit('confirm', { address: result.address, isNew: true });
        this.$emit('update:modelValue', false);
      } catch (err) {
        // Surface a friendly version of the server error. Common case is a
        // username collision; fall back to the raw message for everything else.
        const message = (err && err.message) || '';
        if (/already|exists|taken|unique/i.test(message)) {
          this.createError = this.$t('That name is already taken. Try another.');
        } else {
          this.createError = message || this.$t('Could not create address.');
        }
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style scoped>
/* The dialog uses theme tokens throughout so it tracks light/dark automatically. */

.ln-addr-dialog {
  width: 100%;
  max-width: 420px;
  border-radius: 24px;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
  font-family: 'Manrope', sans-serif;
  overflow: hidden;
}

/* Header */
.ln-addr-header {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
  padding: 1.5rem 1.5rem 1rem;
}

.ln-addr-header-icon {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-accent-soft);
  color: var(--brand-accent);
}

.ln-addr-header-text {
  flex: 1;
  min-width: 0;
}

.ln-addr-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-primary);
}

.ln-addr-subtitle {
  margin-top: 0.25rem;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-secondary);
}

/* Body */
.ln-addr-body {
  padding: 0.5rem 1.5rem 0.75rem;
}

.ln-addr-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 0.875rem;
}

/* Existing-address list */
.ln-addr-list {
  background: var(--bg-input);
  border-radius: 14px;
  padding: 4px;
  margin-bottom: 0.75rem;
}

.ln-addr-item {
  border-radius: 10px;
  min-height: 48px;
  transition: background-color 0.15s ease;
}

.ln-addr-item-selected {
  background: var(--brand-accent-soft);
}

.ln-addr-item-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ln-addr-item-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-all;
}

.ln-addr-check {
  color: var(--brand-accent);
}

/* Input in create mode */
.ln-addr-input {
  background: var(--bg-input);
  border-radius: 12px;
  padding: 0 0.75rem;
  margin-bottom: 0.5rem;
}

.ln-addr-input :deep(.ln-addr-input-inner) {
  font-size: 15px;
  color: var(--text-primary);
  padding: 0.5rem 0;
}

.ln-addr-domain {
  font-size: 14px;
  color: var(--text-muted);
  white-space: nowrap;
}

.ln-addr-preview {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0.5rem 0 0.25rem;
  word-break: break-all;
}

.ln-addr-preview strong {
  color: var(--text-primary);
  font-weight: 600;
}

.ln-addr-error {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  background: rgba(255, 75, 75, 0.1);
  color: #FF4B4B;
  font-size: 13px;
  line-height: 1.4;
}

/* Inline text button used for "create another" / "back" navigation */
.ln-addr-link {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  background: transparent;
  border: none;
  padding: 0.5rem 0;
  margin-top: 0.25rem;
  color: var(--brand-accent);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ln-addr-link:hover {
  opacity: 0.8;
}

/* Actions */
.ln-addr-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem 1.5rem;
}

.ln-addr-skip-btn {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.ln-addr-confirm-btn {
  height: 42px;
  min-width: 150px;
  border-radius: 22px;
  font-size: 14px;
  font-weight: 600;
  background: var(--brand-accent);
  color: #FFFFFF;
}

/* Mobile polish */
@media (max-width: 480px) {
  .ln-addr-dialog {
    max-width: 100%;
    margin: 0.75rem;
  }

  .ln-addr-header {
    padding: 1.25rem 1.25rem 0.875rem;
  }

  .ln-addr-body {
    padding: 0.5rem 1.25rem 0.75rem;
  }

  .ln-addr-actions {
    padding: 0.75rem 1.25rem 1.25rem;
  }

  .ln-addr-confirm-btn {
    min-width: 130px;
  }
}
</style>
