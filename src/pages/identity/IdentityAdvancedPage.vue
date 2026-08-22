<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Keys and apps') }}</h1>
      <p class="id-lede">
        {{ $t('Use your BuhoGO profile in other Nostr apps.') }}
      </p>

      <IdentityGroup
        :title="$t('Public profile')"
      >
        <IdentityRow
          icon="tabler:world"
          tone="accent"
          :label="publicCopied ? $t('Copied') : $t('Copy public ID')"
          :caption="shortNpub"
          mono
          :chevron="false"
          @click="copyPublic"
        />
      </IdentityGroup>

      <IdentityGroup
        :title="$t('Use elsewhere')"
      >
        <IdentityRow
          icon="tabler:external-link"
          :label="$t('Find a Nostr app')"
          :caption="$t('See apps that work with your profile')"
          @click="showClients = true"
        />
      </IdentityGroup>

      <IdentityGroup :title="$t('Private key')">
        <IdentityRow
          icon="tabler:key"
          :label="$t('Use private key')"
          :caption="$t('Only when connecting a trusted Nostr app')"
          @click="showSecretSheet = true"
        />
      </IdentityGroup>
    </div>

    <ClientExamplesSheet v-model="showClients" />

    <q-dialog
      v-model="showSecretSheet"
      position="bottom"
      :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
      @hide="closeSecretSheet"
    >
      <q-card class="identity-surface secret-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-handle" aria-hidden="true"><span></span></div>
        <div class="secret-sheet-head">
          <div>
            <span class="secret-sheet-kicker">{{ $t('Private key') }}</span>
            <h2>{{ $t('Use it in another app') }}</h2>
          </div>
          <q-btn flat round dense :aria-label="$t('Close')" @click="showSecretSheet = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>

        <div class="secret-sheet-body">
          <p>{{ $t('Use this only when a trusted app asks to connect your profile.') }}</p>

          <button type="button" class="btn-ghost" @click="copySecret">
            <Icon icon="tabler:copy" width="18" height="18" />
            <span>{{ secretCopied ? $t('Copied. Clipboard clears in 30 seconds') : $t('Copy private key') }}</span>
          </button>
          <button type="button" class="btn-quiet" @click="toggleReveal">
            <Icon :icon="revealed ? 'tabler:eye-off' : 'tabler:eye'" width="18" height="18" />
            <span>{{ revealed ? $t('Hide it again') : $t('Show private key') }}</span>
          </button>

          <div v-if="revealed && nsec" class="secret-box">
            <code class="secret-value">{{ nsec }}</code>
          </div>
        </div>
      </q-card>
    </q-dialog>

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
      showSecretSheet: false,
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
    closeSecretSheet() {
      this.showSecretSheet = false;
      this.revealed = false;
      this.nsec = '';
      if (this._revealTimer) clearTimeout(this._revealTimer);
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

.secret-sheet { width: 100%; max-width: 520px; border-radius: 24px 24px 0 0; padding-bottom: max(14px, env(safe-area-inset-bottom, 0px)); }
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; }
.sheet-handle span { width: 36px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--text-secondary) 28%, transparent); }
.secret-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 10px 20px 12px; }
.secret-sheet-kicker { display: block; margin-bottom: 3px; color: var(--text-secondary); font-size: 12px; font-weight: 700; }
.secret-sheet-head h2 { margin: 0; color: var(--text-primary); font-size: 21px; font-weight: 740; letter-spacing: -0.025em; }
.secret-sheet-body { padding: 0 20px 10px; }
.secret-sheet-body > p { margin: 0 0 14px; color: var(--text-secondary); font-size: 13.5px; line-height: 1.45; }
.secret-sheet-body .btn-ghost { margin-top: 4px; }
.secret-sheet-body .btn-quiet { margin-top: 2px; }

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
