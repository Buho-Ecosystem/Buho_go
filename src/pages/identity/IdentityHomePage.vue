<template>
  <q-page class="id-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="id-topbar">
      <button
        type="button"
        class="id-topbar-btn"
        :aria-label="$t('Wallet')"
        @click="$router.push('/wallet')"
      >
        <Icon icon="tabler:home" width="21" height="21" />
      </button>
      <div class="id-topbar-spacer"></div>
      <button
        type="button"
        class="id-topbar-btn"
        data-audit="identity-scan"
        :aria-label="$t('Scan')"
        @click="showScanSheet = true"
      >
        <Icon icon="tabler:scan" width="21" height="21" />
      </button>
    </div>

    <div class="id-body">
      <h1 class="id-large-title">{{ $t('You') }}</h1>

      <!-- The card. Everything the user needs to recognise and hand over
           their identity is on one object: photo, name, username, health,
           and the code on its back. -->
      <IdentityCard
        :name="cardName"
        :username="username"
        :avatar="avatarUrl"
        :status="statusLine"
        :status-tone="statusTone"
        :progress="progress"
        :qr-value="qrValue"
        :qr-caption="qrCaption"
        :can-switch="canSwitch"
        :needs-name="needsName"
        @switch-identity="onSwitchIdentity"
        @add-name="$router.push('/identity/profile')"
        @avatar-error="avatarBroken = true"
      />

      <!-- The three things a person actually does with an identity. Present
           from day one: setup never stands in front of use. -->
      <div class="id-verbs">
        <button type="button" class="id-verb" data-audit="identity-share" @click="showShareSheet = true">
          <span class="id-verb-icon"><Icon icon="tabler:share-2" width="19" height="19" /></span>
          <span class="id-verb-label">{{ $t('Share') }}</span>
        </button>
        <button type="button" class="id-verb" data-audit="identity-get-paid" @click="$router.push('/identity/get-paid')">
          <span class="id-verb-icon"><Icon icon="tabler:arrow-bar-to-down" width="19" height="19" /></span>
          <span class="id-verb-label">{{ $t('Get paid') }}</span>
        </button>
        <button type="button" class="id-verb" data-audit="identity-sign-in" @click="$router.push('/identity/sign-in')">
          <span class="id-verb-icon"><Icon icon="tabler:world" width="19" height="19" /></span>
          <span class="id-verb-label">{{ $t('Sign in') }}</span>
        </button>
      </div>

      <!-- Setup, while it lasts. Gone for good once complete. -->
      <template v-if="!setupComplete">
        <SetupLadder :steps="steps" :done="stepsDone" :total="stepsTotal" />
        <p v-if="!cardWordsSaved" class="id-foot">
          {{ $t('Without the 12 words, a lost phone means a lost card. It takes two minutes and a piece of paper.') }}
        </p>
      </template>

      <!-- The payoff once setup is done: the people you actually pay. -->
      <PeopleStrip
        v-if="setupComplete && recentPeople.length > 0"
        :people="recentPeople"
        :total="contactCount"
        @pay="payContact"
        @scan="showScanSheet = true"
        @see-all="$router.push('/address-book')"
      />

      <IdentityGroup class="id-block">
        <IdentityRow
          v-if="!setupComplete || recentPeople.length === 0"
          icon="tabler:address-book"
          :label="$t('Contacts')"
          :caption="contactCount > 0
            ? $t('{n} people you can pay by name', { n: contactCount })
            : $t('No contacts yet')"
          @click="$router.push('/address-book')"
        />
        <IdentityRow
          icon="tabler:adjustments-horizontal"
          :label="$t('Manage your card')"
          :caption="$t('Photo, username, 12 words, more')"
          @click="$router.push('/identity/manage')"
        />
        <IdentityRow
          v-if="!setupComplete"
          icon="tabler:info-circle"
          :label="$t('What is this card for')"
          :caption="$t('One minute, three answers')"
          @click="$router.push('/identity/about')"
        />
      </IdentityGroup>

      <p v-if="!setupComplete" class="id-foot id-foot--last">
        {{ $t('Your card is separate from your money. Nothing here can move your Bitcoin.') }}
      </p>
    </div>

    <!-- Share: one sheet, replacing the two competing ones the old page had. -->
    <IdentityShareSheet v-model="showShareSheet" />

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
import PeopleStrip from '../../components/identity/PeopleStrip.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import IdentityShareSheet from '../../components/identity/IdentityShareSheet.vue';
import AddressBookModal from '../../components/AddressBook/AddressBookModal.vue';
import { useIdentityHealth } from '../../composables/useIdentityHealth';
import { useAddressBookStore } from '../../stores/addressBook';
import { usePayContact } from '../../composables/usePayContact';

/** How many faces fit the strip before it needs scrolling on a small phone. */
const PEOPLE_SHOWN = 8;

export default {
  name: 'IdentityHomePage',

  components: {
    Icon,
    SettingsHubNav,
    IdentityCard,
    SetupLadder,
    PeopleStrip,
    IdentityGroup,
    IdentityRow,
    IdentityShareSheet,
    AddressBookModal,
  },

  setup() {
    const health = useIdentityHealth();
    const addressBook = useAddressBookStore();
    return { ...health, addressBook };
  },

  data() {
    return {
      showShareSheet: false,
      showScanSheet: false,
      avatarBroken: false,
      canSwitch: false,
    };
  },

  computed: {
    cardName() {
      if (this.needsName) return this.$t('Add your name');
      return this.profile.displayName || this.profile.name;
    },

    /**
     * This code carries the identity, not the address: scanning it saves the
     * person. Paying them is Get paid's code, and keeping one verb on each
     * is what stops the two reading as duplicates.
     */
    qrCaption() {
      return this.$t('Someone can scan this to save you as a contact');
    },

    contactCount() {
      return this.addressBook.entries.length;
    },

    /**
     * Most recently added contacts. Sorting by "last paid" would be better,
     * but the address book does not record it yet, and inventing a field for
     * a first release would be a data migration for a nicety.
     */
    recentPeople() {
      return [...this.addressBook.entries]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, PEOPLE_SHOWN);
    },
  },

  watch: {
    'profile.picture'() {
      this.avatarBroken = false;
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();

    // The identity is created the first time someone opens this tab. That is
    // still true, but it is no longer invisible: the card appears with the
    // reserved username already on it, which is the moment it becomes real.
    if (!this.identity.bootstrapped) {
      await this.identity.ensureIdentity();
    }

    // The card footer now reports on the wallet phrase too, and the wallet
    // store only reads its blob inside initialize(). Without this the card
    // would say "Ready" on a cold start purely because no wallets had loaded.
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

.id-topbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: calc(var(--safe-top, 0px) + 6px) 10px 2px;
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
  padding: 15px 8px 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  color: var(--text-primary);
  min-height: 88px;
}

.id-verb:active { background: rgba(127, 127, 127, 0.06); }

.id-verb-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-ms);
  background: var(--bg-input);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
}

.id-verb-label {
  font-size: 12.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
</style>
