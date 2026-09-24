<template>
  <q-page class="id-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <!-- No title: the card right below says who this screen is about
         better than a word could. Scan sits left, home stays far right. -->
    <div class="id-topbar">
      <button
        type="button"
        class="id-topbar-btn"
        data-audit="identity-scan"
        :aria-label="$t('Scan')"
        @click="showScanSheet = true"
      >
        <Icon icon="tabler:scan" width="21" height="21" />
      </button>
      <div class="id-topbar-spacer"></div>
      <!-- Far right, like every hub header: the one universal way home. -->
      <button
        type="button"
        class="id-topbar-btn"
        :aria-label="$t('Home')"
        @click="$router.push('/wallet')"
      >
        <Icon icon="tabler:home" width="21" height="21" />
      </button>
    </div>

    <div class="id-body">
      <!-- The card. Everything the user needs to recognise and hand over
           their identity is on one object: photo, name, public code, setup
           progress, and the scannable code on its back. -->
      <IdentityCard
        :name="cardName"
        :avatar="avatarUrl"
        :progress="progress"
        :qr-value="qrValue"
        :npub="identity.nostrNpub"
        :username="profile.username"
        :qr-caption="qrCaption"
        :can-switch="canSwitch"
        :needs-name="needsName"
        @switch-identity="onSwitchIdentity"
        @add-name="$router.push('/identity/profile')"
        @edit="$router.push('/identity/profile')"
        @avatar-error="avatarBroken = true"
      />

      <!-- The three things a person actually does with an identity. Present
           from day one: setup never stands in front of use. -->
      <div class="id-verbs">
        <button type="button" class="id-verb" data-audit="identity-share" @click="showShareSheet = true">
          <span class="id-verb-icon"><Icon icon="tabler:share-2" width="19" height="19" /></span>
          <span class="id-verb-label">{{ $t('Share') }}</span>
        </button>
        <button type="button" class="id-verb" data-audit="identity-get-paid" @click="showGetPaidSheet = true">
          <span v-if="bucket.paymentCount > 0" class="id-verb-pill" aria-hidden="true">
            {{ bucketPaymentBadge }}
          </span>
          <span class="id-verb-icon"><Icon icon="tabler:arrow-bar-to-down" width="19" height="19" /></span>
          <span class="id-verb-label">{{ $t('Get paid') }}</span>
        </button>
        <button type="button" class="id-verb" data-audit="identity-sign-in" @click="showSignInSheet = true">
          <span class="id-verb-icon"><Icon icon="tabler:world" width="19" height="19" /></span>
          <span class="id-verb-label">{{ $t('Sign in') }}</span>
        </button>
      </div>

      <!-- Setup, while it lasts. Gone for good once complete. -->
      <template v-if="!setupComplete">
        <SetupLadder :steps="steps" :done="stepsDone" :total="stepsTotal" />
      </template>

      <!-- The one invitation to a username, in the ladder's place once the
           name is set: calm, personal, no price, dismissible for good. The
           same slot reports a purchase that is still finishing, so a person
           who paid and closed the sheet never wonders whether it worked. -->
      <IdentityGroup v-else-if="usernameSlot" class="id-block">
        <div v-if="usernameSlot === 'suggest'" class="id-suggest">
          <IdentityRow
            icon="tabler:rosette-discount-check"
            :label="$t('Choose a username')"
            :caption="suggestionCaption"
            :chevron="false"
            @click="showClaimSheet = true"
          />
          <button
            type="button"
            class="id-suggest-dismiss"
            :aria-label="$t('Not now')"
            @click="profile.dismissUsernameSuggestion()"
          >
            <Icon icon="tabler:x" width="16" height="16" />
          </button>
        </div>
        <IdentityRow
          v-else-if="usernameSlot === 'pending'"
          icon="tabler:rosette-discount-check"
          tone="accent"
          :label="$t('Almost ready')"
          :caption="$t('{name} will be on your card in a moment', { name: claimAddress })"
          :chevron="false"
          :interactive="false"
        >
          <template #trailing>
            <q-spinner size="16px" class="id-suggest-spinner" />
          </template>
        </IdentityRow>
        <IdentityRow
          v-else
          icon="tabler:alert-circle"
          tone="warn"
          :label="$t('We couldn\'t finish this name')"
          :caption="$t('Someone took it a moment earlier')"
          :chevron="false"
          @click="identity.clearPendingNip05Claim()"
        />
      </IdentityGroup>

      <!-- The one quiet door. Everything else the tab can do lives on the
           card or in the three verbs above; backing up lives in Security. -->
      <IdentityGroup class="id-block">
        <IdentityRow
          icon="tabler:users"
          :label="$t('Identities')"
          :caption="$t('Switch, or create a new one')"
          @click="$router.push('/identity/identities')"
        />

      </IdentityGroup>
    </div>

    <!-- Share: one sheet, replacing the two competing ones the old page had. -->
    <IdentityShareSheet v-model="showShareSheet" />

    <!-- Receiving is a quick action, so it stays over the card instead of
         navigating away from it. The legacy URL still opens this same sheet. -->
    <IdentityGetPaidSheet v-model="showGetPaidSheet" />

    <!-- Getting a username is a short task over the card, like Get paid;
         Done lands back here with the name already on the card. -->
    <Nip05MarketplaceSheet v-model="showClaimSheet" />

    <!-- Website sign-in is a short, contextual task like Get paid. Keeping it
         in a sheet preserves the user's place on their card. -->
    <IdentitySignInSheet v-model="showSignInSheet" />

    <!-- Scan someone else's card. Same add-contact flow the address book
         uses, landed on its scan tab. -->
    <AddressBookModal
      v-model="showScanSheet"
      initial-tab="scan"
      @saved="onContactSaved"
      @open-existing="onScanContactOpenExisting"
    />

    <SettingsHubNav />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityCard from '../../components/identity/IdentityCard.vue';
import SetupLadder from '../../components/identity/SetupLadder.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import IdentityShareSheet from '../../components/identity/IdentityShareSheet.vue';
import IdentityGetPaidSheet from '../../components/identity/IdentityGetPaidSheet.vue';
import IdentitySignInSheet from '../../components/identity/IdentitySignInSheet.vue';
import AddressBookModal from '../../components/AddressBook/AddressBookModal.vue';
import { useIdentityHealth } from '../../composables/useIdentityHealth';
import { useSocialBucketStore } from '../../stores/socialBucket';
import { usePayContact } from '../../composables/usePayContact';
import { buildNostrIdentityUri } from '../../utils/nostrLookup.js';
import { useUsernameSuggestion } from '../../composables/useUsernameSuggestion';
import { nip05AddressFor } from '../../services/nip05';
import Nip05MarketplaceSheet from '../../components/Nip05MarketplaceSheet.vue';

export default {
  name: 'IdentityHomePage',

  components: {
    Icon,
    SettingsHubNav,
    IdentityCard,
    SetupLadder,
    IdentityGroup,
    IdentityRow,
    IdentityShareSheet,
    IdentityGetPaidSheet,
    IdentitySignInSheet,
    AddressBookModal,
    Nip05MarketplaceSheet,
  },

  setup() {
    const health = useIdentityHealth();
    const bucket = useSocialBucketStore();
    const suggestion = useUsernameSuggestion();
    return { ...health, bucket, ...suggestion };
  },

  data() {
    return {
      showShareSheet: false,
      showGetPaidSheet: false,
      showSignInSheet: false,
      showScanSheet: false,
      showClaimSheet: false,
      avatarBroken: false,
      canSwitch: false,
    };
  },

  computed: {
    bucketPaymentBadge() {
      const count = this.bucket.paymentCount;
      return count > 99 ? '99+' : `+${count}`;
    },

    cardName() {
      if (this.needsName) return this.$t('Add your name');
      return this.profile.displayName || this.profile.name;
    },

    /**
     * The card's name slot holds an instruction rather than a name. Tied to
     * exactly the condition cardName uses, so the slot is a control whenever
     * it is telling the user to do something and never otherwise.
     */
    needsName() {
      return !this.profile.displayName && !this.profile.name;
    },

    avatarUrl() {
      if (!this.profile.picture || this.avatarBroken) return '';
      return this.profile.picture;
    },

    /**
     * What the slot below the verbs shows once setup is done:
     *   'suggest' the invitation, until dismissed
     *   'pending' a paid purchase still finishing
     *   'failed'  a paid purchase that went to someone else first
     *   ''        nothing (has a username, no name yet, or dismissed)
     * An unpaid payment code is not "almost ready"; it shows the invitation,
     * which reopens the sheet where the code is still waiting.
     */
    usernameSlot() {
      if (!this.setupComplete || !this.profile.displayName || this.profile.username) return '';
      const claim = this.identity.pendingNip05Claim;
      if (claim?.failedAt) return 'failed';
      if (claim?.paidAt) return 'pending';
      return this.profile.usernameSuggestionDismissedAt ? '' : 'suggest';
    },

    suggestionCaption() {
      return this.suggestedUsername
        ? this.$t('{name} is available', { name: nip05AddressFor(this.suggestedUsername) })
        : this.$t('A short name people can type to find you');
    },

    claimAddress() {
      return nip05AddressFor(this.identity.pendingNip05Claim?.handle) || '';
    },

    /** The physical card exchange is identity-to-identity, not a web share. */
    qrValue() {
      return buildNostrIdentityUri(this.identity.nostrNpub);
    },

    /**
     * This code carries the identity, not the address: scanning it saves the
     * person. Paying them is Get paid's code, and keeping one verb on each
     * is what stops the two reading as duplicates.
     */
    qrCaption() {
      return this.$t('Someone can scan this to save you as a contact');
    },

  },

  watch: {
    '$route.query.sheet': {
      immediate: true,
      handler(sheet, previousSheet) {
        this.showGetPaidSheet = sheet === 'get-paid';
        this.showSignInSheet = sheet === 'sign-in';
      },
    },

    showGetPaidSheet(isOpen) {
      if (isOpen || this.$route.query.sheet !== 'get-paid') return;
      const query = { ...this.$route.query };
      delete query.sheet;
      this.$router.replace({ path: '/identity', query });
    },

    showSignInSheet(isOpen) {
      if (isOpen || this.$route.query.sheet !== 'sign-in') return;
      const query = { ...this.$route.query };
      delete query.sheet;
      this.$router.replace({ path: '/identity', query });
    },

    'profile.picture'() {
      this.avatarBroken = false;
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();

    // The identity is created the first time someone opens this tab: the
    // card appears with its public code, which is the moment it becomes real.
    if (!this.identity.bootstrapped) {
      await this.identity.ensureIdentity();
    }

    this.refreshSuggestion();

    // The wallet-home badge leads here, so repeat the same live count on the
    // exact action that explains and moves those payments. Arriving counts
    // as looking: once the view has settled, acknowledge the bucket so the
    // home badge goes quiet until new money lands.
    this.bucket.hydrate({ pubkey: this.identity.nostrPubkeyHex }).then(() => (
      this.bucket.sync({ identityStore: this.identity })
    )).catch(() => {}).then(() => this.bucket.markPaymentsSeen());

    // Get paid reads wallet state, and the wallet store only reads its blob
    // inside initialize(). A cold deep link to this tab would otherwise open
    // that sheet with no wallets loaded.
    await this.ensureWalletLoaded();

    // Only offer the switcher when there is something to switch to. A user
    // with one identity should never be shown machinery for many.
    try {
      const list = await this.identity.listNostrIdentities();
      this.canSwitch = Array.isArray(list) && list.length > 1;
    } catch {
      this.canSwitch = false;
    }
  },

  methods: {
    /**
     * What the photo does depends on what the card is missing.
     *
     * With one identity and no photo, the obvious meaning of tapping a blank
     * avatar is "put a picture here", and offering to create a second identity
     * instead is a non sequitur on day one. Once there is more than one
     * identity the photo becomes the switcher, which is the pattern people
     * already know from account switchers.
     */
    onSwitchIdentity() {
      if (this.canSwitch) {
        this.$router.push('/identity/identities');
        return;
      }
      this.$router.push('/identity/profile');
    },


    /**
     * Shared with the address book, so a face tapped here behaves exactly
     * like the same person tapped there: an identity-only contact explains
     * itself and re-syncs rather than doing nothing at all.
     */
    payContact(entry) {
      usePayContact(this).payContact(entry);
    },

    onContactSaved() {
      this.$q.notify({ type: 'positive', message: this.$t('Contact added'), timeout: 2500 });
    },

    onScanContactOpenExisting(entry) {
      if (entry) this.payContact(entry);
    },
  },
};
</script>

<style scoped>
/* The suggestion's dismiss sits over the row's trailing edge as a sibling,
   not inside it: the row is itself a button. 44pt target, quiet glyph. */
.id-suggest { position: relative; }
.id-suggest :deep(.id-row) { padding-right: 56px; }
.id-suggest-dismiss {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-ms);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.id-suggest-dismiss:active { background: rgba(127, 127, 127, 0.12); }
.id-suggest-spinner { color: var(--text-muted); flex: 0 0 auto; }

/* The hub header is gone: this screen has a large title in the body instead,
   which is where a title belongs on a screen nobody pushed into. The page
   cancels the global q-page top padding because the top bar owns the inset. */
.id-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  padding-top: 0;
}

/* One row: title left, actions right. Aligned to the body's content column
   so nothing drifts to the screen edge on wide displays. */
.id-topbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: calc(var(--safe-top, 0px) + 6px) 16px 2px;
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
  flex: 0 0 auto;
}

.id-topbar-spacer { flex: 1; }

.id-topbar-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.id-topbar-btn:active { background: rgba(127, 127, 127, 0.12); }

.id-body {
  flex: 1 1 auto;
  padding: 0 16px calc(104px + var(--safe-bottom, 0px));
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}

.id-verbs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 9px;
  margin-top: 14px;
}

.id-verb {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 17px 8px 15px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  color: var(--text-primary);
  min-height: 102px;
  position: relative;
}

.id-verb-pill {
  position: absolute;
  top: 7px;
  right: 7px;
  min-width: 23px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: #10b981;
  color: #07140f;
  border: 2px solid var(--bg-card);
  font: 800 9px/1 'Manrope', sans-serif;
  letter-spacing: -0.02em;
  pointer-events: none;
}

.id-verb:active { background: rgba(127, 127, 127, 0.06); }

.id-verb-icon {
  width: 46px;
  height: 46px;
  border-radius: var(--radius-ms);
  background: var(--bg-input);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
}

.id-verb-label {
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
</style>
