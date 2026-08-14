<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="backLabel" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Your card') }}</h1>

      <!--
        The three questions a person actually has, answered without a single
        word they would have to look up. This replaces a five slide carousel
        that fired once per identity and could never be reopened, which is
        why nobody who needed it ever saw it twice.
      -->
      <div v-for="card in cards" :key="card.title" class="about-card">
        <span class="about-icon"><Icon :icon="card.icon" width="17" height="17" /></span>
        <div>
          <div class="about-title">{{ $t(card.title) }}</div>
          <p class="about-body">{{ $t(card.body) }}</p>
        </div>
      </div>

      <!-- The sentence that ends the most expensive confusion in the app. -->
      <div class="about-note">
        <Icon icon="tabler:info-circle" width="17" height="17" />
        <span>{{ $t('Your card holds your name, your photo and your contacts. Your wallet holds your money. They are two separate things with two separate sets of words.') }}</span>
      </div>

      <button type="button" class="btn-ghost" @click="$router.back()">{{ $t('Got it') }}</button>
    </div>

    <SettingsHubNav />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';

const CARDS = [
  {
    icon: 'tabler:at',
    title: 'People can pay you by name',
    body: 'Instead of a long code, friends just need your name. It works from BuhoGO and from most other Bitcoin apps.',
  },
  {
    icon: 'tabler:world',
    title: 'Some websites let you in with it',
    body: 'No email, no password, nothing to remember. The website never learns your name or your balance.',
  },
  {
    icon: 'tabler:shield-lock',
    title: '12 words bring it back',
    body: 'Your card lives on this phone. Save its 12 words and you can bring it back on any phone. Lose them and the card is gone.',
  },
];

export default {
  name: 'IdentityAboutPage',

  components: { Icon, SettingsHubNav, IdentityNav },

  data() {
    return { cards: CARDS };
  },

  computed: {
    /**
     * Reachable from the card and from Manage, so the back label follows
     * where the user actually came from rather than guessing.
     */
    backLabel() {
      const from = this.$router.options.history.state?.back;
      return from === '/identity/manage' ? this.$t('Manage') : this.$t('You');
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
  margin: 2px 2px 14px;
}

.about-card {
  display: flex;
  gap: 13px;
  align-items: flex-start;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 18px;
  padding: 17px;
  margin-bottom: 11px;
}

.about-icon {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  background: var(--brand-accent-soft);
  color: var(--brand-accent);
  flex: 0 0 auto;
}

.about-title {
  font-size: 15.5px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
}

.about-body {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 5px 0 0;
}

.about-note {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 13px;
  border-radius: 14px;
  background: var(--bg-input);
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 15px;
}

.about-note svg { color: var(--text-muted); margin-top: 1px; flex: 0 0 auto; }

.btn-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 15.5px;
  font-weight: 650;
  padding: 15px 18px;
  border-radius: 15px;
  min-height: 52px;
  margin-top: 16px;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-card);
  cursor: pointer;
}
</style>
