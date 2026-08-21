<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="identity-surface sign-in-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <div class="sheet-grab" aria-hidden="true"><span></span></div>

      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Sign in') }}</div>
        <button
          type="button"
          class="sign-help-button"
          :aria-label="$t('Where does this work')"
          @click="openHelp"
        >
          <Icon icon="tabler:info-circle" width="20" height="20" />
        </button>
        <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sign-in-body">
        <p class="sign-in-lede">{{ $t('Some websites let you in with your card instead of a password.') }}</p>

        <!-- The frequent action leads. Saved sites are reference/history and
             therefore sit below it, regardless of how many there are. -->
        <button
          type="button"
          class="sign-add-card"
          data-audit="identity-add-site"
          @click="openAddSite"
        >
          <span class="sign-add-icon"><Icon icon="tabler:scan" width="21" height="21" /></span>
          <span class="sign-add-copy">
            <strong>{{ $t('Sign in somewhere new') }}</strong>
            <small>{{ $t('Scan the code the website shows') }}</small>
          </span>
          <Icon icon="tabler:chevron-right" width="18" height="18" class="sign-chevron" />
        </button>

        <section v-if="sites.length" class="sign-sites" aria-labelledby="sign-sites-title">
          <h2 id="sign-sites-title">{{ $t('Your sites') }}</h2>
          <div class="sign-sites-list">
            <button
              v-for="site in sites"
              :key="site.domain"
              type="button"
              class="sign-site-row"
              data-audit="identity-site-row"
              @click="openSite(site)"
            >
              <SiteFavicon :domain="site.domain" :size="38" />
              <span class="sign-site-copy">
                <strong>{{ displayDomain(site.domain) }}</strong>
                <small>{{ $t('Last used {when}', { when: lastUsed(site.lastUsedAt) }) }}</small>
              </span>
              <Icon icon="tabler:chevron-right" width="18" height="18" class="sign-chevron" />
            </button>
          </div>
        </section>

        <p v-else class="sign-empty">{{ $t('You have not signed in to any website yet.') }}</p>

        <p class="sign-privacy">
          <Icon icon="tabler:shield-lock" width="16" height="16" />
          <span>{{ $t('Websites never see your name, your photo, your contacts or your balance.') }}</span>
        </p>
      </div>
    </q-card>
  </q-dialog>

  <q-dialog v-model="showHelp" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
    <q-card class="identity-surface sign-help-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>
      <div class="sign-help-head">
        <h2>{{ $t('Where does this work') }}</h2>
        <q-btn flat round dense :aria-label="$t('Close')" @click="showHelp = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>
      <div class="sign-help-body">
        <p>{{ $t('A few websites you can sign in to with your BuhoGO card. No password, no email.') }}</p>
        <a
          v-for="site in exampleSites"
          :key="site.domain"
          :href="site.url"
          target="_blank"
          rel="noopener noreferrer"
          class="sign-help-site"
        >
          <SiteFavicon :domain="site.domain" :size="28" shape="rounded-square" />
          <span>{{ site.name }}</span>
          <Icon icon="tabler:external-link" width="14" height="14" />
        </a>
      </div>
    </q-card>
  </q-dialog>

  <!-- Each child task replaces this sheet instead of stacking above it.
       When the child closes, this scoped overview returns. -->
  <AddSiteSheet v-model="showAddSite" @submit="onAddSiteSubmitted" />
  <IdentityAuthDialog v-model="showAuth" :challenge="pendingChallenge" />
  <ConnectedSiteSheet v-model="showSiteSheet" :site="selectedSite" @forget="forgetSite" />
</template>

<script>
import { Icon } from '@iconify/vue';
import SiteFavicon from '../SiteFavicon.vue';
import AddSiteSheet from '../AddSiteSheet.vue';
import IdentityAuthDialog from '../IdentityAuthDialog.vue';
import ConnectedSiteSheet from '../ConnectedSiteSheet.vue';
import { useIdentityStore } from '../../stores/identity';

export default {
  name: 'IdentitySignInSheet',

  components: {
    Icon,
    SiteFavicon,
    AddSiteSheet,
    IdentityAuthDialog,
    ConnectedSiteSheet,
  },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue'],

  setup() {
    return { identity: useIdentityStore() };
  },

  data() {
    return {
      showAddSite: false,
      showAuth: false,
      pendingChallenge: null,
      showSiteSheet: false,
      showHelp: false,
      selectedDomain: null,
      returningFromChild: false,
      authHandoffPending: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(value) { this.$emit('update:modelValue', value); },
    },

    sites() {
      return this.identity.connectedSitesSorted;
    },

    selectedSite() {
      if (!this.selectedDomain) return null;
      return this.identity.connectedSites.find((site) => site.domain === this.selectedDomain) || null;
    },

    exampleSites() {
      return [
        { name: 'Satsback', domain: 'satsback.com', url: 'https://satsback.com' },
        { name: 'Bitrefill', domain: 'bitrefill.com', url: 'https://bitrefill.com' },
        { name: 'Stacker News', domain: 'stacker.news', url: 'https://stacker.news' },
        { name: 'Einundzwanzig Portal', domain: 'einundzwanzig.space', url: 'https://einundzwanzig.space' },
        { name: 'LN Markets', domain: 'lnmarkets.com', url: 'https://lnmarkets.com' },
      ];
    },
  },

  watch: {
    modelValue: {
      immediate: true,
      handler(isOpen) {
        if (isOpen) this.identity.hydrate();
      },
    },

    showAddSite(value, previous) {
      if (!value && previous && !this.authHandoffPending) this.returnFromChild();
    },

    showAuth(value, previous) {
      if (!value && previous) this.returnFromChild();
    },

    showSiteSheet(value, previous) {
      if (!value && previous) this.returnFromChild();
    },

    showHelp(value, previous) {
      if (!value && previous) this.returnFromChild();
    },
  },

  methods: {
    displayDomain(domain) {
      return String(domain || '').replace(/^www\./i, '');
    },

    lastUsed(timestamp) {
      if (!timestamp) return '';
      const days = Math.floor((Date.now() - timestamp) / 86400000);
      if (days === 0) return this.$t('today');
      if (days === 1) return this.$t('yesterday');
      if (days < 30) return this.$t('{n} days ago', { n: days });
      const months = Math.floor(days / 30);
      if (months < 12) return this.$t('{n} months ago', { n: months });
      return this.$t('{n} years ago', { n: Math.floor(months / 12) });
    },

    handOffTo(openChild) {
      this.returningFromChild = true;
      this.open = false;
      // Quasar's sheet leave transition finishes before the next modal opens;
      // this avoids a briefly stacked pair of sheets and keeps one clear task.
      setTimeout(openChild, 320);
    },

    openAddSite() {
      this.handOffTo(() => { this.showAddSite = true; });
    },

    openHelp() {
      this.handOffTo(() => { this.showHelp = true; });
    },

    openSite(site) {
      this.selectedDomain = site.domain;
      this.handOffTo(() => { this.showSiteSheet = true; });
    },

    returnFromChild() {
      if (!this.returningFromChild) return;
      setTimeout(() => {
        this.open = true;
        this.returningFromChild = false;
      }, 320);
    },

    onAddSiteSubmitted(challenge) {
      this.authHandoffPending = true;
      this.pendingChallenge = challenge;
      setTimeout(() => {
        this.showAuth = true;
        this.authHandoffPending = false;
      }, 320);
    },

    forgetSite(domain) {
      this.identity.removeConnectedSite(domain);
      this.$q.notify({
        type: 'info',
        message: this.$t('Removed {site}', { site: this.displayDomain(domain) }),
        caption: this.$t('This only clears the record on your phone. Signing in there again will add it back.'),
        timeout: 4000,
      });
      this.showSiteSheet = false;
      this.selectedDomain = null;
    },
  },
};
</script>

<style scoped>
.sign-in-sheet {
  width: 100%;
  max-width: 520px;
  max-height: min(86dvh, 760px);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
}

.sign-help-button {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.sign-help-button:active { background: var(--bg-input); }

.sign-help-sheet { width: 100%; max-width: 520px; max-height: min(78dvh, 680px); border-radius: var(--radius-xl) var(--radius-xl) 0 0; overflow: hidden; padding-bottom: max(12px, env(safe-area-inset-bottom, 0px)); }
.sign-help-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 20px 10px; }
.sign-help-head h2 { margin: 0; color: var(--text-primary); font: 720 21px 'Manrope', sans-serif; letter-spacing: -0.025em; }
.sign-help-body { overflow-y: auto; padding: 0 20px 16px; }
.sign-help-body > p { margin: 0 0 12px; color: var(--text-secondary); font-size: 13.5px; line-height: 1.45; }

.sign-help-site {
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
  text-decoration: none;
  border-top: 1px solid var(--border-card);
}

.sign-help-site :deep(.site-favicon-wrap) { width: 28px !important; height: 28px !important; flex: 0 0 28px; }

.sign-help-site span { flex: 1; font: 640 13px 'Manrope', sans-serif; }
.sign-help-site > svg { color: var(--text-muted); }

.sign-in-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px 16px 12px;
}

.sign-in-lede {
  margin: 0 2px 15px;
  color: var(--text-secondary);
  font-size: 13.5px;
  line-height: 1.5;
}

.sign-add-card {
  width: 100%;
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid var(--brand-accent-soft);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  background: var(--brand-accent-soft);
  text-align: left;
  cursor: pointer;
}

.sign-add-card:active { opacity: 0.82; }

.sign-add-icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  color: var(--brand-accent-text);
  background: var(--bg-card);
}

.sign-add-copy,
.sign-site-copy { min-width: 0; flex: 1; }

.sign-add-copy strong,
.sign-add-copy small,
.sign-site-copy strong,
.sign-site-copy small { display: block; }

.sign-add-copy strong { font: 700 15px 'Manrope', sans-serif; }
.sign-add-copy small,
.sign-site-copy small { margin-top: 3px; color: var(--text-secondary); font-size: 12px; }
.sign-chevron { flex: 0 0 auto; color: var(--text-muted); }

.sign-sites { margin-top: 20px; }
.sign-sites h2 { margin: 0 4px 8px; color: var(--text-secondary); font: 680 12px 'Manrope', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; }

.sign-sites-list {
  overflow: hidden;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}

.sign-site-row {
  width: 100%;
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  color: var(--text-primary);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.sign-site-row:last-child { border-bottom: 0; }
.sign-site-row:active { background: var(--bg-input); }
.sign-site-copy strong { overflow: hidden; text-overflow: ellipsis; font: 660 14px 'Manrope', sans-serif; }

.sign-empty {
  margin: 16px 4px 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.sign-privacy {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 18px 4px 0;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.sign-privacy svg { flex: 0 0 auto; margin-top: 1px; }
</style>
