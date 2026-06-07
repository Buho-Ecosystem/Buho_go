<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="site-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <template v-if="site">
        <!-- Hero: large favicon + domain + tagline -->
        <q-card-section class="site-hero">
          <SiteFavicon :domain="site.domain" :size="56" class="site-hero-icon" />
          <div class="site-hero-meta">
            <div class="site-hero-domain" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
              {{ displayDomain }}
            </div>
            <div class="site-hero-action" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ actionDescription }}
            </div>
          </div>
        </q-card-section>

        <!-- Facts grid -->
        <q-card-section class="site-facts">
          <div class="site-fact">
            <div class="site-fact-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('First connected') }}
            </div>
            <div class="site-fact-value" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ formatAbsolute(site.firstLinkedAt) }}
            </div>
          </div>
          <div class="site-fact">
            <div class="site-fact-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('Last used') }}
            </div>
            <div class="site-fact-value" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ formatAbsolute(site.lastUsedAt) }}
            </div>
          </div>
          <div class="site-fact">
            <div class="site-fact-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('Times signed in') }}
            </div>
            <div class="site-fact-value" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
              {{ site.useCount || 1 }}
            </div>
          </div>
        </q-card-section>

        <!-- Privacy note: explain why "Forget" is local-only so users
             don't believe they're revoking their account on the site
             itself. Same honest framing the toast notification uses. -->
        <q-card-section class="site-privacy" :class="$q.dark.isActive ? 'site-privacy-dark' : 'site-privacy-light'">
          <Icon icon="tabler:info-circle" width="14" height="14" class="site-privacy-icon" />
          <span class="site-privacy-text">
            {{ $t('{site} still keeps your public key on its end. Removing it here only clears the local record.', { site: displayDomain }) }}
          </span>
        </q-card-section>

        <!-- Actions -->
        <q-card-actions class="site-actions">
          <q-btn
            unelevated
            no-caps
            class="site-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            @click="visitSite"
          >
            <Icon icon="tabler:external-link" width="16" height="16" class="q-mr-sm" />
            {{ $t('Visit {site}', { site: displayDomain }) }}
          </q-btn>
          <q-btn
            flat
            no-caps
            class="site-forget-btn"
            @click="forget"
          >
            <Icon icon="tabler:trash" width="16" height="16" class="q-mr-sm" />
            {{ $t('Forget this site') }}
          </q-btn>
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import SiteFavicon from './SiteFavicon.vue';

export default {
  name: 'ConnectedSiteSheet',

  components: { Icon, SiteFavicon },

  props: {
    modelValue: { type: Boolean, required: true },
    /**
     * The site object from `identityStore.connectedSites`. May be null
     * between sheet opens; the template guards on `v-if="site"` so the
     * sheet never tries to render with an undefined domain.
     */
    site: { type: Object, default: null },
  },

  emits: ['update:modelValue', 'forget'],

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * Strip the leading `www.` for the headline. Cosmetic only — the
     * stored domain (used for keying / removing) still keeps the host
     * verbatim so we can match the LUD-04 challenge that comes back
     * next time. Users don't think of `www.bitrefill.com` as different
     * from `bitrefill.com`, so neither should the sheet.
     */
    displayDomain() {
      if (!this.site?.domain) return '';
      return this.site.domain.replace(/^www\./i, '');
    },

    actionDescription() {
      switch (this.site?.lastAction) {
        case 'register': return this.$t('You created an account here with your BuhoGO identity.');
        case 'link':     return this.$t('You linked an existing account here to your BuhoGO identity.');
        case 'auth':     return this.$t('You approved an action here with your BuhoGO identity.');
        case 'login':
        default:         return this.$t('You sign in here with your BuhoGO identity.');
      }
    },
  },

  methods: {
    /**
     * Open the site in the system browser. `window.open` works in both
     * web (new tab) and Capacitor (defers to the device browser), so
     * one call covers both platforms without pulling in extra plugins.
     */
    visitSite() {
      const url = `https://${this.site.domain}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    forget() {
      this.$emit('forget', this.site.domain);
      this.open = false;
    },

    /**
     * Absolute date format ("13 May 2026") for the facts grid.
     * Localised through the browser's Intl so it follows the user's
     * device language without us having to ship translation tables.
     */
    formatAbsolute(epochMs) {
      if (!epochMs) return '-';
      try {
        return new Intl.DateTimeFormat(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
        }).format(epochMs);
      } catch {
        return new Date(epochMs).toDateString();
      }
    },
  },
};
</script>

<style scoped>
.site-sheet {
  width: 100%;
  max-width: 520px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  overflow: hidden;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.sheet-handle-bar-light,
.sheet-handle-bar-dark {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  display: block;
}

.sheet-handle-bar-light {
  background: rgba(15, 23, 42, 0.18);
}

.sheet-handle-bar-dark {
  background: rgba(255, 255, 255, 0.22);
}

/* ── Hero ── */

.site-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 20px 4px;
}

.site-hero-icon {
  flex: 0 0 auto;
}

.site-hero-meta {
  flex: 1 1 auto;
  min-width: 0;
}

.site-hero-domain {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.site-hero-action {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  margin-top: 4px;
}

/* ── Facts grid ── */

.site-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 20px 4px;
}

.site-fact {
  min-width: 0;
}

.site-fact-label {
  font-family: 'Manrope', sans-serif;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.site-fact-value {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
}

@media (max-width: 360px) {
  .site-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ── Privacy note ── */

.site-privacy {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 20px 0;
  padding: 10px 12px;
  border-radius: 10px;
  border-left: 2px solid #94a3b8;
}

.site-privacy-light {
  background: #f1f5f9;
  color: #475569;
}

.site-privacy-dark {
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
}

.site-privacy-icon {
  flex: 0 0 auto;
  margin-top: 2px;
}

.site-privacy-text {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.5;
}

/* ── Actions ── */

.site-actions {
  padding: 16px 20px 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.site-primary-btn {
  width: 100%;
  height: 46px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

.site-forget-btn {
  width: 100%;
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #ef4444;
}
</style>
