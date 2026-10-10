<!--
  UnknownSenderBanner
  Shown at the top of a thread whose other side is not in the address book
  (nostrdesign.org: a name is a claim, not an identity).

    - Always: "Not in your contacts" and a fragment of the npub, which is the
      only thing that cannot be faked.
    - lookalikeName: the claimed name resembles one of the user's contacts;
      the banner says so, in plain words, and that this is another profile.
    - No verification mark, ever (NIP-05 is not proof of who someone is).
    - Actions: Add contact · Block (44 pt each).
-->
<template>
  <section class="unknown-banner" role="group" :aria-label="$t('Not in your contacts')">
    <Icon icon="tabler:alert-triangle" width="20" height="20" class="unknown-banner__icon" />
    <div class="unknown-banner__body">
      <h3 class="unknown-banner__title">{{ $t('Not in your contacts') }}</h3>
      <p class="unknown-banner__text">
        <template v-if="lookalikeName">
          {{ $t('The name looks like your contact {name}, but this is a different profile. Only pay if you are sure.', { name: lookalikeName }) }}
        </template>
        <template v-else>
          {{ $t('Only pay if you are sure who this is.') }}
        </template>
      </p>
      <p class="unknown-banner__npub">
        <span class="unknown-banner__npub-label">{{ $t('Profile') }}</span>
        <code :title="npub">{{ fragment }}</code>
      </p>
      <div class="unknown-banner__actions">
        <button type="button" class="unknown-btn" :disabled="busy" @click="$emit('add-contact')">
          {{ $t('Add contact') }}
        </button>
        <button type="button" class="unknown-btn unknown-btn--danger" :disabled="busy" @click="$emit('block')">
          {{ $t('Block') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue'
import { shortNpub } from './chatFormat.js'
import './chatTokens.css'

export default {
  name: 'UnknownSenderBanner',
  components: { Icon },
  props: {
    /** The sender's full npub. Only a fragment is drawn. */
    npub: { type: String, required: true },
    /** Name of an existing contact the sender's claimed name resembles. */
    lookalikeName: { type: String, default: '' },
    busy: { type: Boolean, default: false }
  },
  emits: ['add-contact', 'block'],
  computed: {
    fragment() {
      return shortNpub(this.npub)
    }
  }
}
</script>

<style scoped>
.unknown-banner {
  display: flex;
  gap: 12px;
  margin: 8px 0;
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--chat-danger-line);
  background: var(--chat-danger-soft);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
}
.unknown-banner__icon { flex: 0 0 auto; margin-top: 0; color: var(--chat-danger); }
.unknown-banner__body { min-width: 0; flex: 1; }
.unknown-banner__title { margin: 0; font-size: 0.9375rem; font-weight: 750; line-height: 1.3; letter-spacing: normal; color: var(--chat-danger); }
.unknown-banner__text { margin: 4px 0 0; font-size: 0.8125rem; line-height: 1.45; color: var(--text-secondary); }

.unknown-banner__npub {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.unknown-banner__npub code {
  font-family: var(--font-mono);
  font-size: 0.78125rem;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.unknown-banner__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.unknown-btn {
  flex: 1 1 8rem;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 22px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 750;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.unknown-btn--danger { color: var(--chat-danger); }
.unknown-btn:disabled { opacity: 0.45; cursor: default; }
.unknown-btn:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
</style>
