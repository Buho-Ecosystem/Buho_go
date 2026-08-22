<!--
  ClientExamplesSheet

  Surfaces concrete apps where the user can sign in with their
  BuhoGO profile's private key. Reached from the "Where can I use
  this key?" row on the Advanced screen, right after the user
  reveals the key — the exact moment they're asking "ok, where do
  I take this?".

  Pattern mirrors the other identity information sheets:
    - Bottom sheet, mobile-native, dismissible by swipe / tap-outside
    - Brand names stay untranslated
    - One-line tagline IS translatable
    - Domain shown small + monospace for visual anchoring

  Purely informational. No external network calls, no clipboard
  reads, no deep links — by design. We don't want this component
  pretending to "open" an app and then failing silently if it isn't
  installed.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="identity-surface examples-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <div class="sheet-grab" aria-hidden="true"><span></span></div>

      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Use your profile elsewhere') }}</div>
        <q-btn
          flat
          round
          class="sheet-close"
          @click="open = false"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-body examples-body">
        <p class="examples-lede">
          {{ $t('These Nostr apps can use the same public profile. Choose one you trust when you sign in.') }}
        </p>

        <div class="examples-section-label">{{ $t('Profile apps') }}</div>
        <ul class="examples-list">
          <li
            v-for="client in clients"
            :key="client.name"
            class="examples-item-wrap"
          >
            <a
              :href="client.url"
              target="_blank"
              rel="noopener noreferrer"
              class="examples-item"
              :class="$q.dark.isActive ? 'examples-item-dark' : 'examples-item-light'"
            >
              <SiteFavicon
                :domain="client.domain"
                :icon-url="client.icon || ''"
                :size="36"
                shape="rounded-square"
              />
              <div class="examples-item-meta">
                <div
                  class="examples-item-name"
                  :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
                >
                  {{ client.name }}
                </div>
                <div
                  class="examples-item-tagline"
                  :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
                >
                  {{ client.tagline }}
                </div>
              </div>
              <div class="examples-item-side">
                <div
                  class="examples-item-platforms"
                  :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
                >
                  {{ client.platforms }}
                </div>
                <Icon
                  icon="tabler:external-link"
                  width="14"
                  height="14"
                  :class="$q.dark.isActive ? 'examples-item-chev-dark' : 'examples-item-chev-light'"
                />
              </div>
            </a>
          </li>
        </ul>

      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import SiteFavicon from './SiteFavicon.vue';

export default {
  name: 'ClientExamplesSheet',

  components: { Icon, SiteFavicon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue'],

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * Profile apps in intentional display order. Lotus is the first-party
     * path from BuhoGO and stays first; the remaining examples follow.
     */
    /*
     * Each entry may carry an optional `icon` path pointing to a
     * bundled brand asset under `/public/clients/`. We use bundled
     * assets only for sites whose own origin doesn't serve a
     * working apple-touch-icon / favicon (Primal, Amethyst, WISP at
     * time of writing). Sites that do serve a working icon
     * (Yakihonne, Jumble) omit `icon` and fall through to
     * SiteFavicon's live-fetch chain — keeps the bundled-asset
     * surface small and means new releases of those apps pick up
     * any rebrand automatically.
     */
    clients() {
      return [
        {
          name: 'Lotus',
          tagline: this.$t('One peaceful place for your day, your people and your ideas.'),
          platforms: this.$t('Web app'),
          url: 'https://lotus.mybuho.de/app',
          domain: 'lotus.mybuho.de',
          icon: '/clients/lotus_logo.png',
        },
        {
          name: 'Primal',
          tagline: this.$t('Polished social app with built-in Bitcoin payments.'),
          platforms: this.$t('iOS, Android'),
          url: 'https://primal.net',
          domain: 'primal.net',
          icon: '/clients/primal_logo.png',
        },
        {
          name: 'Yakihonne',
          tagline: this.$t('Long-form posts, zaps, and a curated community feed.'),
          platforms: this.$t('iOS, Android'),
          url: 'https://yakihonne.com',
          domain: 'yakihonne.com',
        },
        {
          name: 'Amethyst',
          tagline: this.$t('Feature-rich open-source Android client.'),
          platforms: this.$t('Android'),
          url: 'https://www.amethyst.social',
          domain: 'amethyst.social',
          icon: '/clients/amethyst_logo.png',
        },
        {
          name: 'WISP',
          tagline: this.$t('Lightweight mobile client built for quick browsing.'),
          platforms: this.$t('iOS, Android'),
          url: 'https://wisp.mobile',
          domain: 'wisp.mobile',
          icon: '/clients/WISP_logo.png',
        },
        {
          name: 'Jumble',
          tagline: this.$t('Browse and post from any browser. No install needed.'),
          platforms: 'jumble.social',
          url: 'https://jumble.social',
          domain: 'jumble.social',
        },
      ];
    },
  },
};
</script>

<style scoped>
.examples-sheet {
  max-height: 85vh;
  border-radius: 18px 18px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  flex-shrink: 0;
}

.sheet-handle-bar-light {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(15, 23, 42, 0.18);
  display: block;
}

.sheet-handle-bar-dark {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.22);
  display: block;
}

.examples-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 4px;
  flex-shrink: 0;
}

.examples-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.examples-body {
  padding: 4px 20px 20px;
  overflow-y: auto;
}

.examples-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 14px;
}

/*
  Small uppercase label that breaks the list into "On your phone"
  vs "In a browser" so the user instantly knows which row matches
  their device. Keeps the same visual weight as section headers
  elsewhere in the app.
*/
.examples-section-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: -0.01em;
  margin-top: 10px;
  margin-bottom: 6px;
}

.examples-list {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/*
  `<li>` wrapper exists only so the inner element can be a fully-
  tappable <a>. CSS lives on the <a> below.
*/
.examples-item-wrap {
  margin: 0;
  padding: 0;
}

.examples-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.1s ease;
  -webkit-tap-highlight-color: transparent;
}

.examples-item:active {
  transform: scale(0.985);
}

.examples-item-light {
  background: rgba(15, 23, 42, 0.04);
}

.examples-item-light:hover {
  background: rgba(15, 23, 42, 0.07);
}

.examples-item-dark {
  background: rgba(255, 255, 255, 0.04);
}

.examples-item-dark:hover {
  background: rgba(255, 255, 255, 0.07);
}

.examples-item-meta {
  flex: 1 1 auto;
  min-width: 0;
}

.examples-item-name {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
}

.examples-item-tagline {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  margin-top: 2px;
}

/*
  Right-side stack: platform/domain text on top, small external-link
  chevron below. Signals tappability without competing with the
  name+tagline on the left.
*/
.examples-item-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.examples-item-platforms {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.examples-item-chev-light {
  color: rgba(15, 23, 42, 0.45);
}

.examples-item-chev-dark {
  color: rgba(255, 255, 255, 0.45);
}

</style>
