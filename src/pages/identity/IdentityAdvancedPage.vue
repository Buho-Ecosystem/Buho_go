<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to">
      <template #actions>
        <button
          type="button"
          class="nav-help"
          :aria-label="$t('Help')"
          @click="showHelp = true"
        >
          <Icon icon="tabler:help-circle" width="21" height="21" />
        </button>
      </template>
    </IdentityNav>

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Keys') }}</h1>
      <p class="id-lede">
        {{ $t('For connecting your card to another app. Most people never need this screen.') }}
      </p>

      <IdentityGroup
        :title="$t('Public code')"
        :footer="$t('Safe to hand out. It only lets apps and people find your card.')"
      >
        <IdentityRow
          icon="tabler:world"
          tone="accent"
          :label="publicCopied ? $t('Copied') : $t('Copy public code')"
          :caption="shortNpub"
          mono
          :chevron="false"
          @click="copyPublic"
        />
      </IdentityGroup>

      <IdentityGroup
        :title="$t('Secret key')"
        :footer="$t('The secret key is the card itself. Whoever has it can be you.')"
      >
        <IdentityRow
          icon="tabler:copy"
          :label="secretCopied ? $t('Copied. Clipboard clears in 30 seconds') : $t('Copy secret key')"
          :caption="$t('Only for an app you trust')"
          :chevron="false"
          @click="copySecret"
        />
        <IdentityRow
          :icon="revealed ? 'tabler:eye-off' : 'tabler:eye'"
          :label="revealed ? $t('Hide secret key') : $t('Show secret key')"
          :chevron="false"
          @click="toggleReveal"
        />
      </IdentityGroup>

      <div v-if="revealed && nsec" class="secret-box">
        <code class="secret-value">{{ nsec }}</code>
      </div>
    </div>

    <!-- What the two keys are for + apps to try, behind the header's "?". -->
    <ClientExamplesSheet v-model="showHelp" />

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
      showHelp: false,
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

.secret-box {
  margin-top: 2px;
  margin-bottom: 14px;
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

/* The header's one action: a quiet round help button, 44pt target. */
.nav-help {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.nav-help:active {
  background: rgba(127, 127, 127, 0.12);
}
</style>
