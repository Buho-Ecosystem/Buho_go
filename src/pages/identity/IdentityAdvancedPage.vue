<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Manage')" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Advanced') }}</h1>
      <p class="id-lede">
        {{ $t('Your card works in other Bitcoin and social apps. They ask for the key below.') }}
      </p>

      <!--
        Copy first, reveal second.

        The safeguarding guidance is direct about this: prefer a copy button
        and keep the secret off the screen, because the realistic threat is
        the person standing next to you rather than an attack on the device.
        The old dialog rendered the key by default with two timers running
        and put the phishing warning after the reveal.
      -->
      <IdentityGroup :footer="$t('This key is made from your 12 words, so there is nothing extra to write down. Anyone who gets it becomes you, forever. Never paste it into a website that asks you to log in.')">
        <IdentityRow
          icon="tabler:lock"
          tone="danger"
          :label="$t('Copy my secret key')"
          :caption="secretCopied
            ? $t('Copied. The clipboard clears in {n} seconds', { n: 30 })
            : $t('Clipboard clears after 30 seconds')"
          :chevron="false"
          @click="copySecret"
        />
        <IdentityRow
          icon="tabler:eye"
          :label="revealed ? $t('Hide it again') : $t('Show it on screen')"
          :caption="$t('Only if nobody is looking')"
          :chevron="false"
          @click="toggleReveal"
        />
      </IdentityGroup>

      <div v-if="revealed && nsec" class="secret-box">
        <code class="secret-value">{{ nsec }}</code>
      </div>

      <IdentityGroup :title="$t('Also here')">
        <IdentityRow
          icon="tabler:copy"
          :label="publicCopied ? $t('Copied') : $t('Copy my public code')"
          :caption="$t('Some apps use this to find you')"
          :chevron="false"
          @click="copyPublic"
        />
        <IdentityRow
          icon="tabler:info-circle"
          :label="$t('Which apps accept it')"
          @click="showClients = true"
        />
      </IdentityGroup>
    </div>

    <ClientExamplesSheet v-model="showClients" />

    <SettingsHubNav />
  </q-page>
</template>

<script>
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import ClientExamplesSheet from '../../components/ClientExamplesSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { copySensitive, cancelPendingSensitiveClear } from '../../utils/sensitiveClipboard';

/** How long the key stays on screen once revealed. */
const REVEAL_MS = 60_000;

export default {
  name: 'IdentityAdvancedPage',

  components: { SettingsHubNav, IdentityNav, IdentityGroup, IdentityRow, ClientExamplesSheet },

  setup() {
    return { identity: useIdentityStore() };
  },

  data() {
    return {
      nsec: '',
      revealed: false,
      secretCopied: false,
      publicCopied: false,
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
   * Leaving the screen drops the key from memory and cancels the pending
   * clipboard wipe, so a closed screen never keeps a timer running while
   * the user is doing something unrelated.
   */
  beforeUnmount() {
    this.nsec = '';
    if (this._revealTimer) clearTimeout(this._revealTimer);
    if (this._copyTimer) clearTimeout(this._copyTimer);
    cancelPendingSensitiveClear();
  },

  methods: {
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
          message: this.$t('Could not read your key'),
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
.id-sub-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  padding-top: var(--safe-top, 0px);
}

.id-sub-body {
  flex: 1 1 auto;
  padding: 0 16px calc(104px + var(--safe-bottom, 0px));
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}

.id-large-title {
  font-size: 30px;
  font-weight: 770;
  letter-spacing: -0.035em;
  line-height: 1.12;
  color: var(--text-primary);
  margin: 2px 2px 8px;
}

.id-lede {
  font-size: 14.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 2px 16px;
}

.secret-box {
  margin-top: 12px;
  padding: 14px;
  border-radius: 14px;
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
