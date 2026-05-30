<template>
  <!--
    First-open intro for the Profile page. Shown exactly once per
    identity (gated by `identity.profileIntroSeenAt`). Layout mirrors
    SparkSuccessWizard so users feel they are inside the same family
    of onboarding surfaces: top bar (logo + Skip), illustration +
    title + body, dot indicators, primary CTA. Maximized q-dialog
    instead of a route so it overlays the page they were navigating
    to and disappears cleanly on dismiss without a router transition.
  -->
  <q-dialog
    :model-value="modelValue"
    @update:model-value="onUpdateModel"
    maximized
    transition-show="fade"
    transition-hide="fade"
    persistent
  >
    <q-card
      class="intro-card"
      :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'"
    >
      <div class="intro-container">

        <div class="intro-topbar">
          <div class="intro-logo">
            <img src="/buho_logo.svg" alt="Buho" class="intro-logo-img" />
          </div>
          <q-btn flat no-caps dense class="skip-btn" @click="finish">
            {{ $t('Skip') }}
          </q-btn>
        </div>

        <q-carousel
          v-model="currentSlide"
          swipeable
          animated
          transition-prev="slide-right"
          transition-next="slide-left"
          :navigation="false"
          :arrows="false"
          :infinite="false"
          class="intro-carousel"
        >
          <q-carousel-slide
            v-for="slide in slides"
            :key="slide.name"
            :name="slide.name"
            class="intro-slide"
          >
            <div class="slide-content">
              <img :src="slide.image" class="slide-illustration" alt="" />
              <h2
                class="slide-title"
                :class="$q.dark.isActive ? 'text-white' : 'text-dark'"
              >
                {{ $t(slide.title) }}
              </h2>
              <p
                class="slide-text"
                :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
              >
                {{ $t(slide.body) }}
              </p>
            </div>
          </q-carousel-slide>
        </q-carousel>

        <div class="intro-dots">
          <span
            v-for="slide in slides"
            :key="slide.name"
            class="dot"
            :class="{ active: currentSlide === slide.name }"
            @click="currentSlide = slide.name"
          />
        </div>

        <div class="intro-nav">
          <q-btn
            unelevated
            no-caps
            :label="isLastSlide ? $t('Got it') : $t('Next')"
            class="intro-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            @click="onPrimary"
          />
        </div>

      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { useIdentityStore } from '../stores/identity';

const SLIDES = [
  {
    name: 'welcome',
    image: '/Onboarding wizard spark/storyset-mobile-user-bro.svg',
    title: 'Your BuhoGO Identity',
    body: 'One profile, yours alone. It works across BuhoGO and the social apps you sign in to.',
  },
  {
    name: 'personalize',
    image: '/Onboarding wizard spark/storyset-personal-settings-bro.svg',
    title: 'Make it yours',
    body: 'Pick a picture, choose a name, and add a Lightning Address so people can pay you with a handle.',
  },
  {
    name: 'share',
    image: '/Onboarding wizard spark/storyset-share-link-bro.svg',
    title: 'Share your profile',
    body: 'Hand someone a QR code or a link. They can save you, follow you on social media, or send you sats in one tap.',
  },
  {
    name: 'scan',
    image: '/Onboarding wizard spark/storyset-qr-code-bro.svg',
    title: 'Add friends with a scan',
    body: 'Scan another BuhoGO profile and they land straight in your address book, ready for the next payment.',
  },
  {
    name: 'sign-in',
    image: '/Onboarding wizard spark/storyset-secure-login-bro.svg',
    title: 'Log in with Lightning',
    body: 'Use your wallet to buy vouchers on Bitrefill, sign in to services, and skip passwords for good. No accounts to create.',
  },
];

export default {
  name: 'ProfileIntroDialog',

  props: {
    modelValue: { type: Boolean, default: false },
  },

  // `finish` fires whenever the user reaches the end of the carousel
  // — by completing the last slide OR by skipping. Both paths share the
  // same semantics ("user is done with the intro"), so the parent can
  // chain a single follow-up (currently: open the profile editor).
  // Distinct from `update:modelValue:false` so a future programmatic
  // close (e.g. route change) does not falsely trigger that follow-up.
  emits: ['update:modelValue', 'finish'],

  setup() {
    const identity = useIdentityStore();
    return { identity };
  },

  data() {
    return {
      slides: SLIDES,
      currentSlide: SLIDES[0].name,
    };
  },

  computed: {
    isLastSlide() {
      return this.currentSlide === this.slides[this.slides.length - 1].name;
    },
  },

  watch: {
    // Reset to first slide whenever the dialog re-opens so a user who
    // dismissed mid-flow does not land on slide 4 next time. The seen
    // flag prevents a normal re-open, but the prop can still toggle
    // from a manual trigger (e.g. a future "Show intro again" action).
    modelValue(open) {
      if (open) this.currentSlide = this.slides[0].name;
    },
  },

  methods: {
    onUpdateModel(value) {
      // `persistent` blocks ESC / backdrop dismissal, but Quasar can
      // still emit on programmatic close. Treat any close as "seen".
      if (!value) this.finish();
      else this.$emit('update:modelValue', value);
    },

    onPrimary() {
      if (this.isLastSlide) {
        this.finish();
        return;
      }
      const idx = this.slides.findIndex(s => s.name === this.currentSlide);
      this.currentSlide = this.slides[idx + 1].name;
    },

    finish() {
      this.identity.markProfileIntroSeen();
      this.$emit('update:modelValue', false);
      this.$emit('finish');
    },
  },
};
</script>

<style scoped>
.intro-card {
  background: var(--bg-primary);
  box-shadow: none;
  border-radius: 0;
  display: flex;
}

.bg-dark { background: var(--bg-primary); }
.bg-light { background: var(--bg-primary); }

.intro-container {
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.intro-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: max(16px, var(--safe-top, 0px)) 20px 0;
  flex-shrink: 0;
}

.intro-logo-img {
  height: 30px;
  width: auto;
  display: block;
}

.skip-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
}

.intro-carousel {
  width: 100%;
  flex: 1;
  min-height: 0;
  background: transparent !important;
}

.intro-slide {
  padding: 0;
}

.slide-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  height: 100%;
  padding: 0 24px;
}

.slide-illustration {
  width: 90%;
  max-width: 380px;
  max-height: 42vh;
  object-fit: contain;
  margin-top: auto;
  margin-bottom: 0;
  flex-shrink: 1;
}

.slide-title {
  font-family: 'Manrope', sans-serif;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
  margin: 40px 0 8px 0;
  flex-shrink: 0;
}

.slide-text {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 400;
  line-height: 1.55;
  margin: 0 0 auto 0;
  max-width: 310px;
  flex-shrink: 0;
}

.intro-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 12px 20px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
}

body.body--light .dot {
  background: rgba(0, 0, 0, 0.15);
}

.dot.active {
  width: 24px;
  border-radius: 4px;
  background: linear-gradient(90deg, #059573, #15DE72);
}

.intro-nav {
  padding: 0 20px 24px;
  padding-bottom: max(24px, var(--safe-bottom, 16px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.intro-btn {
  width: 100%;
  padding: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
  border-radius: 16px;
}
</style>
