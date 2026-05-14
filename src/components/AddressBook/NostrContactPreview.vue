<template>
  <div
    class="nostr-preview"
    :class="$q.dark.isActive ? 'nostr-preview-dark' : 'nostr-preview-light'"
  >
    <!-- Header row: avatar + name + nip05 -->
    <div class="preview-head">
      <ContactAvatar
        class="preview-avatar"
        :picture="profile && profile.picture"
        :name="displayName"
        :color="fallbackColor"
      />

      <div class="preview-identity">
        <div class="preview-name" :title="displayName">
          {{ displayName }}
        </div>

        <!-- nip05 / npub secondary line. Verified nip05 wins the row;
             we fall back to a shortened npub so the contact is never
             without an identity hint. -->
        <div v-if="nip05Line" class="preview-handle">
          <Icon
            v-if="nip05Verified === true"
            icon="tabler:rosette-discount-check"
            width="14"
            height="14"
            class="preview-handle-icon preview-handle-icon--verified"
          />
          <Icon
            v-else-if="nip05Verified === false"
            icon="tabler:alert-triangle"
            width="14"
            height="14"
            class="preview-handle-icon preview-handle-icon--warn"
          />
          <span class="preview-handle-text">{{ nip05Line }}</span>
        </div>
        <div v-else class="preview-handle preview-handle--muted">
          <span class="preview-handle-text">{{ shortenedNpub }}</span>
        </div>
      </div>
    </div>

    <!-- Bio (clamped). Skipped when empty so the card collapses. -->
    <div v-if="about" class="preview-bio">{{ about }}</div>

    <!-- Payment row. Either a Lightning-address chip or an inline note
         that the profile has no payment metadata. Locked decision #6
         forbids manual override so we never offer to fill it in. -->
    <div class="preview-pay-row">
      <div v-if="lud16" class="preview-pay-chip preview-pay-chip--ok">
        <Icon icon="tabler:bolt" width="13" height="13" />
        <span class="preview-pay-value">{{ lud16 }}</span>
      </div>
      <div v-else class="preview-pay-chip preview-pay-chip--missing">
        <Icon icon="tabler:bolt-off" width="13" height="13" />
        <span class="preview-pay-value">{{ $t('No Lightning address yet') }}</span>
      </div>
    </div>

    <!-- Footer CTA. Three mutually-exclusive states:
           1. already-saved → open the existing entry
           2. payable + new → primary save CTA
           3. not payable   → soft explanation, save disabled  -->
    <div class="preview-footer">
      <template v-if="existingEntry">
        <div class="preview-status preview-status--info">
          {{ $t('Already in your address book') }}
        </div>
        <button
          type="button"
          class="preview-cta preview-cta--secondary"
          @click="$emit('open-existing', existingEntry)"
        >
          {{ $t('Open contact') }}
        </button>
      </template>

      <template v-else-if="lud16">
        <button
          type="button"
          class="preview-cta preview-cta--primary"
          :disabled="saving"
          @click="$emit('save')"
        >
          <q-spinner v-if="saving" size="14px" class="q-mr-xs" />
          <span>{{ saving ? $t('Saving…') : $t('Save to address book') }}</span>
        </button>
      </template>

      <template v-else>
        <div class="preview-status preview-status--muted">
          {{ $t('This profile has no Lightning address yet, so we cannot save it for payments.') }}
        </div>
        <button
          type="button"
          class="preview-cta preview-cta--secondary"
          @click="$emit('copy-npub', npub)"
        >
          <Icon icon="tabler:copy" width="14" height="14" class="q-mr-xs" />
          {{ $t('Copy Nostr identifier') }}
        </button>
      </template>
    </div>
  </div>
</template>

<script>
/**
 * Shared "you found this profile" preview.
 *
 * Both the Search and Scan add-flows resolve a Nostr identifier to
 * the same shape (pubkey + npub + parsed kind:0 content). This
 * component owns the single visual moment where the user decides
 * whether to save that profile.
 *
 * Stateless on purpose: every input arrives via props, every user
 * intent leaves via an emit. Easier to compose, easier to test, and
 * the parent stays in control of the network/storage side.
 *
 * Three CTA states (mutually exclusive):
 *   - already saved → open existing entry (no duplicate save path)
 *   - payable & new → primary "Save to address book"
 *   - no lud16      → soft note + "Copy npub" escape hatch (locked
 *                     decision #6 forbids saving a contact without a
 *                     Lightning address)
 */
import ContactAvatar from './ContactAvatar.vue';

export default {
  name: 'NostrContactPreview',

  components: { ContactAvatar },

  props: {
    /** 64-char lowercase hex. */
    pubkey: { type: String, required: true },
    /** Bech32 npub — used for the shortened-fallback handle. */
    npub: { type: String, required: true },
    /**
     * Parsed kind:0 `content` object. We never trust shape — the
     * computed fields below normalise everything so a hostile
     * profile can't crash the render.
     */
    profile: { type: Object, default: () => ({}) },
    /**
     * Tri-state NIP-05 trust signal:
     *   true  → name matched the pubkey we resolved
     *   false → server returned a different pubkey (NIP-05 mismatch)
     *   null  → no NIP-05, or we didn't check
     * The card shows a check / warning icon accordingly. Truthy values
     * never replace the user's pubkey — they only annotate the row.
     */
    nip05Verified: { type: Boolean, default: null },
    /** Set when the same pubkey is already saved locally. */
    existingEntry: { type: Object, default: null },
    /** Parent-controlled spinner on the save button. */
    saving: { type: Boolean, default: false },
    /** Fallback initial-tile color when no avatar is available. */
    fallbackColor: { type: String, default: '#15DE72' },
  },

  emits: ['save', 'open-existing', 'copy-npub'],

  computed: {
    displayName() {
      const candidates = [
        this.profile?.display_name,
        this.profile?.displayName,
        this.profile?.name,
      ];
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 80);
      }
      return this.shortenedNpub;
    },

    about() {
      const raw = this.profile?.about;
      if (typeof raw !== 'string') return '';
      const trimmed = raw.trim();
      if (!trimmed) return '';
      // Hard ceiling so a multi-kilobyte bio can't push the CTA
      // off-screen on mobile. The card stays readable; full bio
      // lives on the detail page.
      return trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;
    },

    lud16() {
      const raw = this.profile?.lud16;
      return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
    },

    nip05Line() {
      const raw = this.profile?.nip05;
      if (typeof raw !== 'string' || !raw.trim()) return '';
      // NIP-05 spec: when the local part is `_` the identifier
      // renders as just `<domain>`. Same rule as our resolver.
      const trimmed = raw.trim();
      if (trimmed.startsWith('_@')) return trimmed.slice(2);
      return trimmed;
    },

    shortenedNpub() {
      const n = this.npub || '';
      if (n.length <= 16) return n;
      return `${n.slice(0, 10)}…${n.slice(-4)}`;
    },
  },
};
</script>

<style scoped>
.nostr-preview {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-card);
  background: var(--bg-card, #FAF7EF);
}

.nostr-preview-dark {
  background: #0C0C0C;
}

/* Head */
.preview-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}

/* ContactAvatar inherits this class for sizing. */
.preview-avatar {
  width: 52px;
  height: 52px;
  font-size: 22px;
  border: 1px solid var(--border-card);
}

.preview-identity {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.preview-name {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-handle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.preview-handle--muted {
  opacity: 0.7;
}

.preview-handle-text {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-handle-icon {
  flex-shrink: 0;
}

.preview-handle-icon--verified {
  color: var(--color-green);
}

.preview-handle-icon--warn {
  color: #C97A0F;
}

/* Bio */
.preview-bio {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

/* Pay row */
.preview-pay-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.preview-pay-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.6rem;
  border-radius: var(--radius-pill);
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1px;
  max-width: 100%;
  min-width: 0;
}

.preview-pay-chip--ok {
  background: rgba(5, 149, 115, 0.12);
  color: #059573;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.22);
}

.nostr-preview-dark .preview-pay-chip--ok {
  background: rgba(21, 222, 114, 0.16);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.28);
}

.preview-pay-chip--missing {
  background: rgba(120, 120, 120, 0.10);
  color: var(--text-muted);
  box-shadow: inset 0 0 0 1px rgba(120, 120, 120, 0.20);
}

.preview-pay-value {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Footer */
.preview-footer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.1rem;
}

.preview-status {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
}

.preview-status--info {
  color: var(--text-secondary);
}

.preview-status--muted {
  color: var(--text-muted);
}

.preview-cta {
  height: 40px;
  border-radius: var(--radius-xl);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.preview-cta:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.preview-cta--primary {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
}

.preview-cta--secondary {
  background: transparent;
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px var(--border-card);
}

.preview-cta--secondary:hover {
  background: rgba(120, 120, 120, 0.06);
}
</style>
