<template>
  <q-dialog
    v-model="open"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onDialogHidden"
  >
    <q-card
      class="identity-auth-dialog"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Header -->
      <q-card-section class="auth-header">
        <div
          class="auth-title"
          :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'"
        >
          {{ headerTitle }}
        </div>
        <q-btn
          flat
          round
          dense
          :disable="step === 'signing'"
          @click="cancel"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Step: Confirm.
           Pruned for non-technical users — favicon + domain + one
           privacy line. No state chip ("First time here"/"Welcome back"
           added no value: the favicon and domain already tell the user
           where they are), no fingerprint hex, no documentation copy. -->
      <template v-if="step === 'confirm'">
        <q-card-section class="auth-body auth-body--center">
          <SiteFavicon
            v-if="challenge?.domain"
            :domain="challenge.domain"
            :size="48"
            class="auth-site-favicon"
          />
          <div
            class="auth-site-domain"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ displayDomain }}
          </div>

          <!-- One-line privacy reassurance. Replaces the headline, the
               body lede, and the longer callout. Same idea: the site
               only sees a login key; nothing else. -->
          <div
            class="auth-privacy"
            :class="$q.dark.isActive ? 'auth-privacy-dark' : 'auth-privacy-light'"
          >
            <Icon icon="tabler:shield-check" width="14" height="14" />
            <span>{{ $t('The site only sees a login key. Nothing else.') }}</span>
          </div>
        </q-card-section>

        <q-card-actions class="auth-actions auth-actions--stack">
          <q-btn
            unelevated
            no-caps
            class="auth-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="approveLabel"
            @click="approve"
          />
          <q-btn
            flat
            no-caps
            class="auth-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Not now')"
            @click="cancel"
          />
        </q-card-actions>
      </template>

      <!-- Step: Signing / submitting. Two-line layout: spinner above,
           "Signing in to {site}" below. Drops the noisy second line that
           said the same thing twice ("Signing you in" + "Talking to X"). -->
      <template v-else-if="step === 'signing'">
        <q-card-section class="auth-body auth-body--center">
          <div class="auth-spinner">
            <q-spinner-dots size="48px" color="grey-6" />
          </div>
          <div
            class="auth-signing-line"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ signingLine }}
          </div>
        </q-card-section>
      </template>

      <!-- Step: Success. Big green check, site domain echoed back so
           the user can confirm they're done with the right place,
           single "Done" action. We deliberately do NOT offer a
           "Continue to {site}" button: LUD-04 only carries the auth
           endpoint, not the page the user was on, so a homepage
           redirect would lose context for mid-flow users (e.g.
           someone signing in to complete a cart on /checkout). The
           user's original tab is still open in their browser — they
           just switch back to it. -->
      <template v-else-if="step === 'success'">
        <q-card-section class="auth-body auth-body--center">
          <div class="auth-success-mark">
            <Icon icon="tabler:circle-check-filled" width="64" height="64" />
          </div>
          <h2
            class="auth-headline auth-headline--success"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ successHeadline }}
          </h2>
          <p
            class="auth-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ successBody }}
          </p>
        </q-card-section>

        <q-card-actions class="auth-actions">
          <q-btn
            unelevated
            no-caps
            class="auth-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Done')"
            @click="close"
          />
        </q-card-actions>
      </template>

      <!-- Step: Error (real failures only — CORS is promoted to success).
           Friendly title + description from getUserFriendlyError so no
           raw browser strings ever surface to the user. -->
      <template v-else-if="step === 'error'">
        <q-card-section class="auth-body auth-body--center">
          <div class="auth-error-mark">
            <Icon icon="tabler:alert-circle" width="48" height="48" />
          </div>
          <h2
            class="auth-headline"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ errorTitle }}
          </h2>
          <p
            class="auth-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ errorDescription }}
          </p>
        </q-card-section>

        <q-card-actions class="auth-actions auth-actions--stack">
          <q-btn
            unelevated
            no-caps
            class="auth-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Try again')"
            @click="approve"
          />
          <q-btn
            flat
            no-caps
            class="auth-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Close')"
            @click="close"
          />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useIdentityStore } from '../stores/identity';
import SiteFavicon from './SiteFavicon.vue';
import { buildLud04Callback, submitLud04Callback } from '../utils/lud4';
import { hexToBytes } from '../utils/identityCrypto';
import { getUserFriendlyError } from '../utils/userErrors';

export default {
  name: 'IdentityAuthDialog',

  components: { Icon, SiteFavicon },

  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    /**
     * Parsed challenge from `utils/lud4.parseLud04Input`. Required at the
     * moment the dialog opens; safe to be null between sessions.
     */
    challenge: {
      type: Object,
      default: null,
    },
  },

  emits: ['update:modelValue', 'authenticated'],

  setup() {
    const identity = useIdentityStore();
    return { identity };
  },

  data() {
    return {
      step: 'confirm', // 'confirm' | 'signing' | 'success' | 'error'
      /**
       * Friendly error mapped via `getUserFriendlyError`. Shape mirrors
       * the convention introduced in PR #139 so the language matches the
       * payment-error dialog the user is already used to.
       */
      friendlyError: { title: '', description: '' },
      /**
       * True when the last attempt fell through the browser-CORS path.
       * In that case the signature *did* reach the server, so we promote
       * the dialog to the success state with a "refresh the site" hint
       * rather than dead-ending the user. Web build only; on native the
       * full response is readable and `corsBlocked` stays false.
       */
      corsBlocked: false,
      autoCloseTimer: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * Cosmetic strip of the leading `www.` so the domain reads cleanly
     * in headlines. The underlying challenge.domain still carries the
     * exact host string for signing — domain semantics aren't changed.
     */
    displayDomain() {
      const d = this.challenge?.domain || '';
      return d.replace(/^www\./i, '');
    },

    headerTitle() {
      if (this.step === 'success') return this.$t('Signed in');
      if (this.step === 'error') return this.$t('Login failed');
      // Confirm + signing share the same plain "Sign in" header so the
      // top of the sheet doesn't shift labels during the flow. Action
      // variants change the BUTTON copy, not the header.
      if (this.challenge?.action === 'register') return this.$t('Create account');
      if (this.challenge?.action === 'link')     return this.$t('Link account');
      if (this.challenge?.action === 'auth')     return this.$t('Approve action');
      return this.$t('Sign in');
    },

    approveLabel() {
      switch (this.challenge?.action) {
        case 'register':  return this.$t('Create account');
        case 'link':      return this.$t('Link my identity');
        case 'auth':      return this.$t('Approve');
        case 'login':
        default:          return this.$t('Sign in');
      }
    },

    /**
     * Single-line "Signing in to {site}..." used inside the signing
     * step. Replaces the previous two-line "Signing you in... / Talking
     * to {site}" pair which said the same thing twice.
     */
    signingLine() {
      const site = this.displayDomain;
      switch (this.challenge?.action) {
        case 'register':  return this.$t('Creating your account at {site}...', { site });
        case 'link':      return this.$t('Linking to {site}...', { site });
        case 'auth':      return this.$t('Approving on {site}...', { site });
        case 'login':
        default:          return this.$t('Signing in to {site}...', { site });
      }
    },

    successHeadline() {
      switch (this.challenge?.action) {
        case 'register':  return this.$t("You're signed up");
        case 'link':      return this.$t("You're linked");
        case 'auth':      return this.$t('Approved');
        case 'login':
        default:          return this.$t("You're signed in");
      }
    },

    /**
     * Body copy for the success step. On native we know the server
     * accepted us, so a clean "Head back to the site" line is enough.
     * On web/CORS we couldn't read the OK envelope, so we add a gentle
     * refresh hint in the same single line.
     */
    successBody() {
      const site = this.displayDomain;
      if (this.corsBlocked) {
        return this.$t(
          'Head back to {site}. If it still asks you to sign in, refresh the page.',
          { site },
        );
      }
      return this.$t('Head back to {site} to continue.', { site });
    },

    errorTitle() {
      return this.friendlyError.title || this.$t("Couldn't sign you in");
    },

    errorDescription() {
      return this.friendlyError.description || this.$t('Please try again.');
    },
  },

  watch: {
    modelValue(isOpen) {
      if (isOpen) {
        // Reset every open so a previous error / success doesn't bleed
        // into the next challenge.
        this.step = 'confirm';
        this.friendlyError = { title: '', description: '' };
        this.corsBlocked = false;
      } else {
        this.clearAutoCloseTimer();
      }
    },
  },

  beforeUnmount() {
    this.clearAutoCloseTimer();
  },

  methods: {
    async approve() {
      if (!this.challenge) {
        this.friendlyError = {
          title: this.$t('Nothing to sign in to'),
          description: this.$t('The login request was no longer available.'),
        };
        this.corsBlocked = false;
        this.step = 'error';
        return;
      }

      this.step = 'signing';
      this.friendlyError = { title: '', description: '' };
      this.corsBlocked = false;

      try {
        // 1. Sign the k1 with the per-domain linking key.
        const { sigDerHex, linkingPubHex } = await this.identity.signLud04({
          domain: this.challenge.domain,
          k1: this.challenge.k1,
        });

        // 2. Build the callback URL the service expects.
        const callback = buildLud04Callback(
          this.challenge.url,
          hexToBytes(sigDerHex),
          hexToBytes(linkingPubHex),
        );

        // 3. Fire the GET. The service does its own verify and answers
        //    with `{status: "OK"}` or `{status: "ERROR"}`.
        const result = await submitLud04Callback(callback);

        // 3a. Web/CORS path: the browser refused to expose the reply but
        //     the request itself reached the server and was processed.
        //     This is the *expected* outcome on web for the vast majority
        //     of LUD-04 services, so promote it to a success state with
        //     a refresh hint rather than treat it as failure.
        if (!result.ok && result.corsBlocked) {
          this.corsBlocked = true;
          this.recordSiteAndCelebrate(linkingPubHex);
          return;
        }

        // 3b. Real failure (timeout, network down, ERROR envelope from
        //     the server). Run it through the user-friendly mapper so we
        //     never leak technical strings like "Failed to fetch" or
        //     stack traces.
        if (!result.ok) {
          this.friendlyError = getUserFriendlyError(
            new Error(result.reason || 'identity sign-in failed'),
            'identity',
            this.$t.bind(this),
          );
          this.corsBlocked = false;
          this.step = 'error';
          return;
        }

        // 3c. Clean success — server replied with `{status: "OK"}`.
        this.recordSiteAndCelebrate(linkingPubHex);
      } catch (err) {
        console.error('[IdentityAuth] sign/submit failed', err);
        this.friendlyError = getUserFriendlyError(err, 'identity', this.$t.bind(this));
        this.corsBlocked = false;
        this.step = 'error';
      }
    },

    /**
     * Helper: record the site locally, emit the parent event, switch the
     * dialog to its success step, and schedule auto-close. Used by both
     * the clean-success and the CORS-blocked-soft-success paths so the
     * post-success bookkeeping stays in one place.
     */
    recordSiteAndCelebrate(linkingPubHex) {
      this.identity.recordConnectedSite({
        domain: this.challenge.domain,
        action: this.challenge.action,
        linkingPubHex,
      });

      this.step = 'success';
      this.$emit('authenticated', {
        domain: this.challenge.domain,
        action: this.challenge.action,
        corsBlocked: this.corsBlocked,
      });

      // Auto-close after 8s — long enough for the user to read the
      // success state, recognise the site, and consciously tap
      // "Continue to {site}" if they want the helper redirect. Below
      // ~4s the redirect button feels rushed; above ~10s the dialog
      // overstays its welcome.
      this.clearAutoCloseTimer();
      this.autoCloseTimer = setTimeout(() => this.close(), 8000);
    },


    cancel() {
      // Cancelling during 'signing' is allowed — we don't have a way to
      // unsay an HTTP request that's already in flight, but the user's
      // intent is clear: close the dialog.
      this.close();
    },

    close() {
      this.clearAutoCloseTimer();
      this.open = false;
    },

    clearAutoCloseTimer() {
      if (this.autoCloseTimer) {
        clearTimeout(this.autoCloseTimer);
        this.autoCloseTimer = null;
      }
    },

    onDialogHidden() {
      this.clearAutoCloseTimer();
      this.step = 'confirm';
      this.errorReason = '';
    },
  },
};
</script>

<style scoped>
.identity-auth-dialog {
  width: 100%;
  max-width: 460px;
  border-radius: 20px;
  overflow: hidden;
}

.auth-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 4px;
}

.auth-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.auth-body {
  padding: 8px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.auth-body--center {
  align-items: center;
  text-align: center;
  padding-top: 16px;
  padding-bottom: 8px;
  gap: 10px;
}

/* ── Confirm step (favicon-first) ── */

.auth-site-favicon {
  /* Keep the rendered favicon at its source resolution. SiteFavicon's
     inner img is sized to 70% of the wrapper, so a 48px wrapper gives
     a ~34px image — essentially 1:1 with the 32×32 favicon files most
     sites ship. No more blurry upscaling. */
  margin-bottom: 6px;
}

.auth-site-domain {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  max-width: 100%;
  word-break: break-all;
}

/* Privacy reassurance — single quiet line under the domain, not a card. */
.auth-privacy {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.4;
}

.auth-privacy-light {
  background: rgba(15, 23, 42, 0.05);
  color: #475569;
}

.auth-privacy-dark {
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
}

/* ── Signing / success / error ── */

.auth-headline {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  margin: 4px 0 0;
  line-height: 1.3;
}

.auth-headline--success {
  margin-top: 8px;
}

.auth-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  line-height: 1.55;
  margin: 0;
  max-width: 320px;
}

.auth-spinner {
  display: flex;
  justify-content: center;
  padding: 12px 0 4px;
}

.auth-signing-line {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  margin-top: 4px;
}

.auth-success-mark {
  color: #15DE72;
  display: flex;
  justify-content: center;
}

.auth-error-mark {
  color: #ef4444;
  display: flex;
  justify-content: center;
}

/* Actions */
.auth-actions {
  padding: 0 20px 20px;
  display: flex;
  justify-content: center;
}

.auth-actions--stack {
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.auth-primary-btn {
  width: 100%;
  max-width: 340px;
  height: 48px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.auth-secondary-btn {
  width: 100%;
  max-width: 340px;
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

@media (max-width: 480px) {
  .auth-body {
    padding: 8px 16px 18px;
  }
  .auth-headline {
    font-size: 18px;
  }
  .auth-lede {
    font-size: 12.5px;
  }
}
</style>
