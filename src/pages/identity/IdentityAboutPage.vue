<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('What is this card for') }}</h1>

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
import IdentityNav from '../../components/identity/IdentityNav.vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';

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

  components: { SettingsHubNav, Icon, IdentityNav },

  data() {
    return { cards: CARDS };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },

  },
};
</script>

<style scoped>

.about-card {
  display: flex;
  gap: 13px;
  align-items: flex-start;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 17px;
  margin-bottom: 11px;
}

.about-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-ms);
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
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 15px;
}

.about-note svg { color: var(--text-muted); margin-top: 1px; flex: 0 0 auto; }
</style>
