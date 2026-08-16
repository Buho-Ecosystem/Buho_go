<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Keys and apps') }}</h1>
      <p class="id-lede">
        {{ $t('Use your profile in other Nostr apps. Your public npub is safe to share; your secret key is not.') }}
      </p>

      <IdentityGroup
        :title="$t('Publicly shareable npub')"
        :footer="$t('Your npub helps people and apps find your public profile. It cannot reveal your secret key or spend your Bitcoin.')"
      >
        <IdentityRow
          icon="tabler:world"
          tone="accent"
          :label="publicCopied ? $t('Copied') : $t('Copy my npub')"
          :caption="shortNpub"
          mono
          :chevron="false"
          @click="copyPublic"
        />
      </IdentityGroup>

      <IdentityGroup
        :title="$t('Secret access')"
        :footer="$t('Your secret key gives full control of your profile. Only use it in an app you trust, never on a website that unexpectedly asks for it.')"
      >
        <IdentityRow
          icon="tabler:key"
          tone="danger"
          :label="secretExpanded ? $t('Hide secret-key options') : $t('Use my secret key')"
          :caption="$t('For signing in to another trusted Nostr app')"
          :chevron="!secretExpanded"
          @click="toggleSecretControls"
        />
        <IdentityRow
          icon="tabler:external-link"
          :label="$t('Apps that use your profile')"
          :caption="$t('See examples before sharing your secret key')"
          @click="showClients = true"
        />
      </IdentityGroup>

      <section v-if="secretExpanded" class="secret-controls">
        <div class="secret-warning">
          <Icon icon="tabler:alert-triangle" width="19" height="19" />
          <span>{{ $t('Anyone with this key can act as you. BuhoGO will never ask you to send it to someone.') }}</span>
        </div>

        <button type="button" class="btn-ghost" @click="copySecret">
          <Icon icon="tabler:copy" width="18" height="18" />
          <span>{{ secretCopied ? $t('Copied. Clipboard clears in 30 seconds') : $t('Copy secret key') }}</span>
        </button>
        <button type="button" class="btn-quiet" @click="toggleReveal">
          <Icon :icon="revealed ? 'tabler:eye-off' : 'tabler:eye'" width="18" height="18" />
          <span>{{ revealed ? $t('Hide it again') : $t('Show it on screen') }}</span>
        </button>

        <div v-if="revealed && nsec" class="secret-box">
          <code class="secret-value">{{ nsec }}</code>
        </div>
      </section>
    </div>

    <ClientExamplesSheet v-model="showClients" />

      <SettingsHubNav />

  </q-page>
</template>

<script>
import IdentityNav from '../../components/identity/IdentityNav.vue';
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import ClientExamplesSheet from '../../components/ClientExamplesSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { copySensitive } from '../../utils/sensitiveClipboard';

/** How long the key stays on screen once revealed. */
const REVEAL_MS = 60_000;

export default {
  name: 'IdentityAdvancedPage',

  components: { SettingsHubNav, Icon, IdentityNav, IdentityGroup, IdentityRow, ClientExamplesSheet },

  setup() {
    return { identity: useIdentityStore() };
  },

  data() {
    return {
      nsec: '',
      revealed: false,
      secretCopied: false,
      publicCopied: false,
      secretExpanded: false,
      showClients: false,
      _revealTimer: null,
      _copyTimer: null,
    };
  },

  async created() {
    await this.identity.hydrate();
    if (!this.identity.nostrNpub) await this.identity.loadNostrIdentity();
  },

  /**
   * Leaving the screen drops the key from memory and stops this screen's own
   * timers.
   *
   * The clipboard wipe is deliberately NOT cancelled here. The screen promises
   * "clipboard clears after 30 seconds", and leaving the screen is exactly
   * what a person does right after copying a key into another app. Cancelling
   * the wipe on unmount would break that promise in the one case it exists
   * for, and leave a secret key on the clipboard indefinitely.
   */
  beforeUnmount() {
    this.nsec = '';
    if (this._revealTimer) clearTimeout(this._revealTimer);
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

    shortNpub() {
      const value = this.identity.nostrNpub || '';
      if (value.length <= 24) return value;
      return `${value.slice(0, 16)}…${value.slice(-8)}`;
    },
  },

  methods: {
    toggleSecretControls() {
      this.secretExpanded = !this.secretExpanded;
      if (!this.secretExpanded) {
        this.revealed = false;
        this.nsec = '';
        if (this._revealTimer) clearTimeout(this._revealTimer);
      }
    },

    async loadSecret() {
      if (this.nsec) return this.nsec;
      try {
        const { nsec } = await this.identity.revealNostrSecret();
        this.nsec = nsec;
        return nsec;
      } catch (err) {
        console.warn('[identity-advanced] reveal failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Could not read your secret key'),
          caption: this.$t('Close BuhoGO and open it again.'),
          timeout: 4000,
        });
        return '';
      }
    },

    async copySecret() {
      const nsec = await this.loadSecret();
      if (!nsec) return;
      try {
        await copySensitive(nsec);
        this.secretCopied = true;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.secretCopied = false; }, 30_000);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    async toggleReveal() {
      if (this.revealed) {
        this.revealed = false;
        if (this._revealTimer) clearTimeout(this._revealTimer);
        return;
      }
      const nsec = await this.loadSecret();
      if (!nsec) return;
      this.revealed = true;
      // Auto-hide, same protection the old dialog had, without making the
      // countdown a piece of furniture on the screen.
      this._revealTimer = setTimeout(() => { this.revealed = false; }, REVEAL_MS);
    },

    async copyPublic() {
      const npub = this.identity.nostrNpub;
      if (!npub) return;
      try {
        await navigator.clipboard.writeText(npub);
        this.publicCopied = true;
        setTimeout(() => { this.publicCopied = false; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },
  },
};
</script>

<style scoped>

.secret-controls {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid rgba(255, 68, 68, 0.2);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}

.secret-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-md);
  background: rgba(255, 68, 68, 0.08);
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
}

.secret-warning svg { flex: 0 0 auto; margin-top: 1px; color: var(--color-red); }
.secret-controls .btn-ghost { margin-top: 12px; }
.secret-controls .btn-quiet { margin-top: 2px; }

.secret-box {
  margin-top: 12px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  border: 1px solid var(--border-card);
}

.secret-value {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-all;
}
</style>
