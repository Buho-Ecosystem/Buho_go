<!--
  SiteExamplesSheet

  A small help surface attached to the AddSiteSheet: opens a mobile-
  native bottom sheet listing concrete examples of services that let
  you sign in with the BuhoGO profile. Solves the chicken-and-egg
  problem for first-time users — they tap "Sign in to a site", get
  asked for a link, and have no idea where to find one.

  Purely informational. No external network calls, no clipboard
  reads. Sites are picked for being well-known in the Bitcoin space
  AND for having stable Lightning-login support at the time of
  writing. Names are brand-cased and stay untranslated; the short
  one-liner under each name IS translatable.

  Lives next to AddSiteSheet rather than as a global utility because
  the only place it makes sense is the "add a site" flow.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="examples-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <q-card-section class="examples-header">
        <div
          class="examples-title"
          :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'"
        >
          {{ $t('Where can I sign in?') }}
        </div>
        <q-btn
          flat
          round
          dense
          @click="open = false"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <q-card-section class="examples-body">
        <p
          class="examples-lede"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
        >
          {{ $t('A few sites you can sign in to with your BuhoGO profile. No password, no email.') }}
        </p>

        <ul class="examples-list">
          <li
            v-for="site in sites"
            :key="site.name"
            class="examples-item-wrap"
          >
            <a
              :href="site.url"
              target="_blank"
              rel="noopener noreferrer"
              class="examples-item"
              :class="$q.dark.isActive ? 'examples-item-dark' : 'examples-item-light'"
            >
              <SiteFavicon :domain="site.domain" :size="36" shape="rounded-square" />
              <div class="examples-item-meta">
                <div
                  class="examples-item-name"
                  :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
                >
                  {{ site.name }}
                </div>
                <div
                  class="examples-item-tagline"
                  :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
                >
                  {{ site.tagline }}
                </div>
              </div>
              <div class="examples-item-side">
                <div
                  class="examples-item-domain"
                  :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
                >
                  {{ site.domain }}
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
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import SiteFavicon from './SiteFavicon.vue';

export default {
  name: 'SiteExamplesSheet',

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
     * Curated examples. Order is "consumer-friendliest first" so the
     * first row a user sees is the most concrete and immediately
     * graspable (cashback). LN Markets sits last because its appeal
     * is the most niche (active traders).
     *
     * Brand names stay untranslated; one-liners are translatable.
     * Domains are shown small + monospace so a user can recognise
     * the site even before reading the tagline.
     */
    sites() {
      return [
        {
          name: 'Satsback',
          tagline: this.$t('Earn Bitcoin cashback when you shop online.'),
          domain: 'satsback.com',
          url: 'https://satsback.com',
        },
        {
          name: 'Bitrefill',
          tagline: this.$t('Buy gift cards and prepaid services with Bitcoin.'),
          domain: 'bitrefill.com',
          url: 'https://bitrefill.com',
        },
        {
          name: 'Stacker News',
          tagline: this.$t('A Bitcoin forum where good posts earn sats.'),
          domain: 'stacker.news',
          url: 'https://stacker.news',
        },
        {
          name: 'Einundzwanzig Portal',
          tagline: this.$t('German-speaking Bitcoin community hub.'),
          domain: 'einundzwanzig.space',
          url: 'https://einundzwanzig.space',
        },
        {
          name: 'LN Markets',
          tagline: this.$t('Trade Bitcoin with Lightning-fast settlement.'),
          domain: 'lnmarkets.com',
          url: 'https://lnmarkets.com',
        },
      ];
    },
  },
};
</script>

<style scoped>
.examples-sheet {
  max-height: 80vh;
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

.examples-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* `<li>` is the structural row; the inner <a> carries the styling
   and tappable surface so the whole card is one clean affordance. */
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
  Right-side stack: domain text on top, small external-link chevron
  below. Same shape as ClientExamplesSheet so the two help surfaces
  feel like one family.
*/
.examples-item-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.examples-item-domain {
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
