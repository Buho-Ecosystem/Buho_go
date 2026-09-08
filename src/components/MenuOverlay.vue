<template>
  <q-dialog
    v-model="show"
    maximized
    transition-show="fade"
    transition-hide="fade"
    class="menu-overlay-dialog"
  >
    <!-- The frosted material IS the surface: the home never moves, this
         layer fades in over it and a tap anywhere that is not a door
         closes it again. -->
    <div class="menu-surface" @click="show = false">
      <button
        type="button"
        class="menu-close"
        :aria-label="$t('Close menu')"
        @click.stop="show = false"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M10 6h10M10 12h10M10 18h10M7 9l-3 3 3 3" />
        </svg>
      </button>

      <nav class="menu-doors" :aria-label="$t('Menu')">
        <button
          type="button"
          class="menu-door"
          style="--d: 0ms"
          @click.stop="go('/settings')"
        >
          <span class="menu-door-word">{{ $t('Settings') }}</span>
        </button>

        <button
          type="button"
          class="menu-door"
          style="--d: 70ms"
          :aria-label="profileDoorLabel"
          @click.stop="go('/identity')"
        >
          <span class="menu-door-word">
            {{ $t('Profile') }}
            <span
              v-if="socialBucketStore.hasUnseenPayments"
              class="menu-door-pill menu-door-pill--money"
              aria-hidden="true"
            >{{ bucketBadge }}</span>
          </span>
        </button>

        <button
          type="button"
          class="menu-door"
          style="--d: 140ms"
          @click.stop="go('/spend')"
        >
          <span class="menu-door-word">{{ $t('Spend') }}</span>
        </button>

        <button
          type="button"
          class="menu-door"
          style="--d: 210ms"
          @click.stop="go('/address-book')"
        >
          <span class="menu-door-word">{{ $t('Address Book') }}</span>
        </button>

        <button
          type="button"
          class="menu-door"
          style="--d: 280ms"
          :aria-label="aboutDoorLabel"
          @click.stop="go('/about')"
        >
          <span class="menu-door-word">
            {{ $t('About') }}
            <span
              v-if="updateStore.hasUpdate"
              class="menu-door-pill menu-door-pill--update"
              aria-hidden="true"
            >+1</span>
          </span>
        </button>
      </nav>

      <div class="menu-foot" aria-hidden="true">
        <span class="menu-version">BuhoGO v{{ appVersion }}</span>
      </div>
    </div>
  </q-dialog>
</template>

<script>
import { version } from '../../package.json';
import { useUpdateStore } from '../stores/update';
import { useSocialBucketStore } from '../stores/socialBucket';

/**
 * Full-screen menu behind the wallet toolbar's single trigger. Five doors,
 * one attention vocabulary: the Profile door carries the social-bucket
 * money pill, the About door carries the update pill, and both reuse the
 * exact signals the rest of the app already trusts (paymentCount and
 * updateStore.hasUpdate). The doors glide in from the right and stop dead
 * on their final position; the version line at the foot is informational
 * and untappable.
 */
export default {
  name: 'MenuOverlay',
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  setup() {
    return {
      updateStore: useUpdateStore(),
      socialBucketStore: useSocialBucketStore(),
    };
  },
  computed: {
    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      },
    },

    appVersion() {
      return version;
    },

    bucketBadge() {
      const count = this.socialBucketStore.paymentCount;
      return count > 99 ? '99+' : `+${count}`;
    },

    profileDoorLabel() {
      if (!this.socialBucketStore.hasUnseenPayments) return this.$t('Profile');
      const count = this.socialBucketStore.paymentCount;
      return `${this.$t('Profile')}, ${this.$t('{n} payments waiting', { n: count })}`;
    },

    aboutDoorLabel() {
      if (!this.updateStore.hasUpdate) return this.$t('About');
      return `${this.$t('About')}, ${this.$t('A newer version is ready')}`;
    },
  },
  data() {
    return {
      navigating: false,
    };
  },
  methods: {
    async go(path) {
      if (this.navigating) return;
      this.navigating = true;
      try {
        // Navigate first and keep the frost up while the destination (and
        // its lazy chunk) loads. Closing the dialog first would fade the
        // home screen back in for the gap before the new page mounts.
        // A successful push unmounts the wallet page and this dialog with
        // it, so the menu leaves in the same frame the destination lands.
        await this.$router.push(path);
      } finally {
        this.navigating = false;
        this.show = false;
      }
    },
  },
};
</script>

<style scoped>
/* Frosted overlay material: heavy blur, a tint from the theme, faint
   context kept underneath. */
.menu-surface {
  position: relative;
  width: 100%;
  height: 100%;
  background: rgba(250, 247, 239, 0.72);
  -webkit-backdrop-filter: blur(22px) saturate(1.3);
  backdrop-filter: blur(22px) saturate(1.3);
  font-family: 'Manrope', sans-serif;
  -webkit-tap-highlight-color: transparent;
}

body.body--dark .menu-surface {
  background: rgba(12, 12, 12, 0.62);
}

/* Without backdrop-filter support the tint alone must carry legibility. */
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .menu-surface {
    background: rgba(250, 247, 239, 0.95);
  }

  body.body--dark .menu-surface {
    background: rgba(12, 12, 12, 0.93);
  }
}

/* Mirrors the toolbar trigger's footprint (40pt box, 12px inset below the
   safe area) so opening reads as the same control turning around. */
.menu-close {
  all: unset;
  position: absolute;
  top: calc(var(--safe-top, 0px) + 5px);
  right: 12px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--text-primary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  animation: menu-close-turn 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.menu-close:focus-visible {
  outline: 2px solid var(--brand-accent);
  outline-offset: 2px;
}

@keyframes menu-close-turn {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(180deg);
  }
}

.menu-doors {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
}

/* The arrival: 150px glide on an expo-out curve, full stop on the final
   position with no counter-movement, 70ms cadence via --d. */
.menu-door {
  all: unset;
  position: relative;
  min-height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  opacity: 0;
  -webkit-tap-highlight-color: transparent;
  animation: menu-door-in 460ms cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: var(--d);
}

.menu-door:focus-visible {
  outline: 2px solid var(--brand-accent);
  outline-offset: 4px;
  border-radius: 8px;
}

.menu-door:active .menu-door-word {
  transform: scale(0.97);
}

@keyframes menu-door-in {
  0% {
    opacity: 0;
    transform: translateX(150px);
  }

  60% {
    opacity: 1;
  }

  100% {
    opacity: 1;
    transform: translateX(0);
  }
}

.menu-door-word {
  position: relative;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  text-transform: lowercase;
  color: var(--text-primary);
  transition: transform 0.1s ease;
}

/* Same pill recipe as the toolbar (money) and the logo (update), worn as
   a superscript on the door's word. */
.menu-door-pill {
  position: absolute;
  top: -8px;
  right: -28px;
  min-width: 20px;
  height: 17px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  border: 2px solid var(--bg-primary);
  border-radius: 999px;
  font: 800 9px/1 'Manrope', sans-serif;
  letter-spacing: -0.02em;
  box-sizing: border-box;
  text-transform: none;
}

.menu-door-pill--money {
  background: #10b981;
  color: #07140f;
}

.menu-door-pill--update {
  background: var(--brand-accent);
  color: #08291a;
  box-shadow: 0 2px 7px rgba(5, 149, 115, 0.32);
}

.menu-foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(var(--safe-bottom, 0px) + 24px);
  display: flex;
  justify-content: center;
  pointer-events: none;
}

/* Arrives only once the last door has landed. */
.menu-version {
  font-size: 11.5px;
  color: var(--text-muted);
  opacity: 0;
  animation: menu-fade-in 0.5s ease both;
  animation-delay: 680ms;
}

@keyframes menu-fade-in {
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-door,
  .menu-close,
  .menu-version {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>

<style>
/* The dialog shell must not paint anything of its own: the frosted
   surface above is the whole material, edge to edge, and it fades in
   snappier than Quasar's default. */
.menu-overlay-dialog .q-dialog__backdrop {
  background: transparent;
}

.menu-overlay-dialog .q-transition--fade-enter-active,
.menu-overlay-dialog .q-transition--fade-leave-active {
  transition-duration: 220ms !important;
}
</style>
