<!--
  SendModal
  Input-first Send sheet opened from the wallet's Send button. One tall
  bottom sheet holds every entry path — no nested sub-sheets:

    - Field:     one auto-detecting input (type or paste anything we can
                 pay: invoice, Lightning address, LNURL, Spark, Arkade,
                 Bitcoin, BIP21, npub/nprofile, KE/ZM phone number). A
                 type chip confirms what we recognized; unrecognized text
                 live-filters the contact list instead of erroring.
    - Paste:     reads the clipboard into the field, lets the user verify,
                 then auto-advances. No silent fire-and-forget.
    - Scan:      opens the scanner as a child surface (native MLKit
                 overlay on iOS/Android, qr-scanner video on web). The
                 decoded string lands back in the field so the user
                 always sees what is being resolved.
    - Mobile Money: phone-first entry for the KE/ZM fiat-payout rails,
                 surfacing what the field would otherwise only reveal
                 by accident.
    - Batch send / Manage: forwarded to the parent (BatchSendModal) and
                 the Address Book page.
    - Contacts:  inlined list (favorites → recents → all) with the same
                 payability guards the quick-contacts modal applies.

  All payment-routing logic (BIP21 unwrap, SA-retailer QR conversion,
  Lightning/LNURL/Spark/Bitcoin detection, parent emit, the
  resolving/resolve-error contract with Wallet.onPaymentDetected) is
  unchanged from the previous version — only the presentation layer was
  rebuilt around the field instead of the camera.
-->
<template>
  <q-dialog
    v-model="show"
    position="bottom"
    :persistent="ctaBusy"
    transition-show="slide-up"
    transition-hide="slide-down"
    class="send-sheet-dialog"
    @show="onSheetShow"
    @before-hide="resetState"
  >
    <q-card class="send-sheet" :class="$q.dark.isActive ? 'send-sheet-dark' : 'send-sheet-light'">
      <div class="grab-bar"></div>

      <!-- Always-reachable close. While busy it cancels the whole Send flow
           (the backdrop is persistent then, so this is the one exit). -->
      <q-btn flat round dense class="sheet-close" :aria-label="$t('Close')" @click="closeModal">
        <Icon icon="tabler:x" width="18" height="18" />
      </q-btn>

      <!-- Mobile Money mode header: back arrow + label. The field below
           switches to phone entry; everything else yields to it. -->
      <header v-if="mobileMoneyMode" class="mm-head">
        <q-btn flat round dense class="mm-back" :aria-label="$t('Back')" @click="exitMobileMoney">
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <span class="mm-title">{{ $t('Mobile Money') }}</span>
      </header>

      <!-- ─────────────  ENTRY FIELD  ───────────── -->
      <section class="entry-block">
        <!-- Clipboard suggestion — web only (native platforms surface a
             system "pasted from clipboard" notice on programmatic reads,
             so there the explicit Paste button stays the path). One tap
             applies it; it resolves to the confirm sheet, never sends. -->
        <transition name="type-pill">
          <button
            v-if="showClipboardSuggestion"
            type="button"
            class="clip-suggest"
            data-audit="send-clip-suggest"
            @click="applyClipboardSuggestion"
          >
            <Icon icon="tabler:clipboard-check" width="15" height="15" class="clip-suggest-icon" />
            <span class="clip-suggest-text">{{ clipboardPreview }}</span>
            <span class="clip-suggest-cta">{{ $t('Paste') }}</span>
          </button>
        </transition>
        <textarea
          v-model="manualInput"
          class="manual-textarea"
          :class="{ 'manual-textarea--error': !!resolveError }"
          :placeholder="mobileMoneyMode ? $t('Enter a mobile number') : $t('Enter a name, invoice, or address')"
          rows="3"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :inputmode="mobileMoneyMode ? 'tel' : 'text'"
          :disabled="ctaBusy"
          ref="manualTextarea"
          data-audit="send-input"
          @paste="onTextareaPaste"
        />

        <div class="field-meta">
          <div
            class="input-helper"
            :class="{
              'input-helper--error': !!resolveError,
              'input-helper--warn': !resolveError && !!capabilityBlocked
            }"
          >
            <template v-if="resolveError">
              <Icon icon="tabler:alert-circle" width="13" height="13" class="helper-icon-error" />
              <span>{{ resolveError }}</span>
            </template>
            <template v-else-if="capabilityBlocked">
              <Icon icon="tabler:arrows-exchange" width="13" height="13" class="helper-icon-warn" />
              <span>{{ capabilityBlocked }}</span>
            </template>
            <template v-else-if="mobileMoneyMode">
              <span v-if="mmCountryOption">{{ countryName(mmCountryOption.code) }} · +{{ mmCountryOption.callingCode }}</span>
              <span v-else>{{ $t('Type the number, or pick the country first') }}</span>
            </template>
          </div>
          <transition name="type-pill">
            <div
              v-if="detectedInputType"
              class="detected-pill"
              :class="`detected-pill--${detectedInputType}`"
            >
              <img
                v-if="detectedInputType === 'spark'"
                width="11" height="11"
                :src="$q.dark.isActive ? '/Spark/Spark Asterisk White.svg' : '/Spark/Spark Asterisk Black.svg'"
                alt="Spark"
              />
              <Icon v-else :icon="detectedInputIcon" width="12" height="12" />
              <span>{{ detectedInputLabel }}</span>
            </div>
          </transition>
        </div>
      </section>

      <!-- ─────────────  MOBILE MONEY COUNTRY SELECTOR  ─────────────
           Optional, not a gate: typing a full number still resolves on its
           own. Picking a country locks recognition to it — which also lets
           us accept the bare local number and removes the KE/ZM 07x
           ambiguity before it can appear. -->
      <div v-if="mobileMoneyMode" class="mm-countries">
        <button
          v-for="c in payoutCountries"
          :key="c.code"
          type="button"
          class="mm-country"
          :class="{ 'mm-country--active': mmCountry === c.code }"
          :data-audit="`send-mm-country-${c.code.toLowerCase()}`"
          @click="selectMmCountry(c.code)"
        >
          <img :src="c.logo || c.flag" class="mm-country-logo" alt="" aria-hidden="true" />
          <span class="mm-country-name">{{ countryName(c.code) }}</span>
          <span class="mm-country-cc">+{{ c.callingCode }}</span>
        </button>
      </div>

      <!-- ─────────────  PASTE / SCAN  ───────────── -->
      <div v-if="!mobileMoneyMode && !isValidManualInput" class="quick-actions">
        <button type="button" class="quick-btn" data-audit="send-paste" @click="pasteFromClipboard">
          <Icon icon="tabler:clipboard" width="19" height="19" class="quick-icon" />
          <span>{{ $t('Paste') }}</span>
        </button>
        <button type="button" class="quick-btn" data-audit="send-scan" @click="openScanner">
          <Icon icon="tabler:scan" width="19" height="19" class="quick-icon" />
          <span>{{ $t('Scan') }}</span>
        </button>
      </div>

      <!-- ─────────────  RESOLVING SKELETON  ─────────────
           While the destination is fetched/validated, show the shape of
           what's coming (the confirm sheet's recipient hero) instead of
           any intermediate "we recognized this" card — the next screen
           forming, never a review-this step. Failures land as the inline
           field error; success replaces this with the real sheet. -->
      <section v-if="ctaBusy" class="resolve-skeleton">
        <q-skeleton type="circle" size="44px" animation="wave" />
        <div class="resolve-skeleton-lines">
          <q-skeleton type="text" width="42%" height="16px" animation="wave" />
          <q-skeleton type="text" width="68%" height="12px" animation="wave" />
        </div>
      </section>

      <!-- ─────────────  METHOD ROWS  ───────────── -->
      <div v-if="showMethods" class="method-block">
        <button type="button" class="method-row" data-audit="send-mobile-money" @click="enterMobileMoney">
          <span class="method-icon">
            <Icon icon="tabler:device-mobile" width="20" height="20" />
          </span>
          <span class="method-text">
            <span class="method-title">{{ $t('Mobile Money') }}</span>
            <span class="method-sub">{{ $t('Pay to borderless mobile money') }}</span>
          </span>
          <Icon icon="tabler:chevron-right" width="16" height="16" class="method-chev" />
        </button>
        <div class="method-divider"></div>
        <button type="button" class="method-row" data-audit="send-batch" @click="openBatchSend">
          <span class="method-icon">
            <Icon icon="tabler:stack-2" width="20" height="20" />
          </span>
          <span class="method-text">
            <span class="method-title">{{ $t('Batch Send') }}</span>
            <span class="method-sub">{{ $t('Pay several people at once') }}</span>
          </span>
          <Icon icon="tabler:chevron-right" width="16" height="16" class="method-chev" />
        </button>
      </div>

      <!-- ─────────────  CONTACTS  ───────────── -->
      <section v-if="showContactsSection" class="contacts-section">
        <div class="section-head">
          <span class="section-label">{{ $t('Send to a contact') }}</span>
          <button type="button" class="manage-btn" data-audit="send-manage-contacts" @click="goToAddressBook">
            {{ $t('Manage') }}
          </button>
        </div>

        <div class="contacts-scroll">
          <!-- Loading skeleton on first open -->
          <div v-if="contactsLoading" class="contacts-skeleton">
            <div v-for="n in 4" :key="'sk-' + n" class="skeleton-row">
              <q-skeleton type="circle" size="44px" />
              <q-skeleton type="text" width="45%" />
            </div>
          </div>

          <template v-else-if="displayContacts.length > 0">
            <button
              v-for="contact in displayContacts"
              :key="contact.id"
              type="button"
              class="contact-row"
              :class="{ 'contact-row--unpayable': !isContactPayable(contact) }"
              data-audit="send-contact-row"
              @click="onContactPicked(contact)"
            >
              <!-- Rail dot: icon-only nuance on the avatar, and ONLY for
                   the constrained rails (spark / arkade / on-chain) — a
                   Lightning contact is the payable-everywhere norm and
                   stays clean. Unpayable rows dim; tapping still explains
                   why via the shared capability toast. -->
              <span class="row-avatar-wrap">
                <ContactAvatar class="row-avatar" :entry="contact" />
                <span
                  v-if="contactRailDot(contact)"
                  class="row-rail-dot"
                  :style="{ background: contactRailDot(contact).color }"
                >
                  <svg v-if="contactRailDot(contact).kind === 'spark'" width="9" height="9" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
                  </svg>
                  <ArkadeLogo v-else-if="contactRailDot(contact).kind === 'arkade'" variant="mark" color="white" :size="9" />
                  <Icon v-else icon="tabler:currency-bitcoin" width="10" height="10" />
                </span>
              </span>
              <span class="row-name">
                {{ contact.name }}
                <Icon v-if="contact.isFavorite" icon="tabler:star-filled" width="11" height="11" class="row-star" />
              </span>
              <Icon icon="tabler:chevron-right" width="16" height="16" class="row-chev" />
            </button>
          </template>

          <!-- Typed text matches nothing: neither a payment format nor a
               saved contact. Guidance, not an error — the user may still
               be mid-paste or mid-typo. -->
          <div v-else-if="contactQuery" class="contacts-empty">
            <Icon icon="tabler:search-off" width="26" height="26" class="empty-icon" />
            <p class="empty-title">{{ $t('No matches') }}</p>
            <p class="empty-sub">{{ $t('Keep typing, or paste an invoice or address') }}</p>
          </div>

          <!-- First-run: no contacts saved yet. Paste and Scan above stay
               the obvious next actions; this is a soft pointer, not a wall. -->
          <div v-else class="contacts-empty">
            <Icon icon="tabler:address-book" width="26" height="26" class="empty-icon" />
            <p class="empty-title">{{ $t('No contacts yet') }}</p>
            <p class="empty-sub">{{ $t('People you save appear here for one-tap sending') }}</p>
            <button type="button" class="empty-add-btn" @click="goToAddressBook">
              <Icon icon="tabler:plus" width="15" height="15" />
              <span>{{ $t('Add contact') }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- ─────────────  FOOTER  ───────────── -->
      <footer v-if="ctaBusy || phoneNeedsCountryChoice || isValidManualInput" class="sheet-footer">
        <!-- While we fetch + validate the destination, the CTA becomes the
             shared filling loading-button (same one the send/commit flow
             uses), so the wait reads as "we're resolving this", not a frozen
             button. The parent closes the sheet on success or pushes an
             inline error above on failure. -->
        <ProgressCta v-if="ctaBusy" :label="$t('Fetching…')" />
        <!-- 075-078 are valid mobile prefixes in BOTH Kenya and Zambia.
             Rather than silently guess (and risk paying the wrong country),
             let the user pick. Unambiguous numbers and +CC input skip
             straight to Continue / auto-advance. -->
        <div v-else-if="phoneNeedsCountryChoice" class="country-choice">
          <div class="country-choice-label">{{ $t('Which country?') }}</div>
          <div class="country-choice-list">
            <button
              v-for="c in orderedPhoneCandidates"
              :key="c.country.code"
              type="button"
              class="country-choice-btn"
              @click="selectPhoneCountry(c)"
            >
              <img
                v-if="c.brandLogo"
                :src="c.brandLogo"
                class="country-choice-logo"
                alt=""
                aria-hidden="true"
              />
              <span class="country-choice-text">
                <span class="country-choice-name">{{ countryName(c.country.code) }}</span>
                <span v-if="c.operator" class="country-choice-op">{{ c.operator }}</span>
              </span>
              <span class="country-choice-number">{{ c.display }}</span>
            </button>
          </div>
        </div>
        <button
          v-else
          type="button"
          class="primary-cta"
          data-audit="send-continue"
          :disabled="!!capabilityBlocked"
          @click="processManualInput"
        >
          {{ $t('Continue') }}
        </button>
      </footer>
    </q-card>

    <!-- ─────────────  SCANNER (child surface)  ─────────────
         Shared single-shot scan sheet (native MLKit overlay / web
         qr-scanner). It closes itself on the first decode — the result
         lands in the field, so resolving and errors always happen on
         this sheet. -->
    <QrScanSheet
      v-model="scannerOpen"
      @scanned="onQRDetect"
    />
  </q-dialog>
</template>

<script>
import { Capacitor } from '@capacitor/core';
import QrScanSheet from './QrScanSheet.vue';
import { useAddressBookStore } from '../stores/addressBook';
import { useWalletStore } from '../stores/wallet';
import { isSARetailerQR, convertToLightningAddress, getMerchantInfo, SA_RETAIL_SOURCE } from '../utils/merchantQR';
import { parseBip21, selectBip21Destination, extractLnFallbackParam } from '../utils/bip21';
import {
  isSparkAddress,
  isArkadeAddress,
  isBolt12Offer,
  isLightningInvoice,
  isLnurl,
  isBitcoinAddress,
  isLightningAddress,
  stripWrapperScheme,
} from '../utils/addressUtils';
import {
  recognizePhoneNumber,
  recognizePhoneNumberForCountry,
  matchLnAddressService,
  payoutCountryOptions,
} from '../services/lnAddressServices';
import { getPreferredPayoutCountry, rememberPayoutCountry } from '../utils/payoutCountryPreference';
import { classifyIdentifier, LOOKUP_ERROR } from '../utils/nostrLookup';
import { canWalletPay, walletSwitchHint } from '../utils/walletCapabilities';
import { resolveNostrLightningTarget, NOSTR_TARGET_ERROR } from '../services/nostrPaymentTarget';
import ContactAvatar from './AddressBook/ContactAvatar.vue';
import ArkadeLogo from './ArkadeLogo.vue';
import ProgressCta from './ProgressCta.vue';

export default {
  name: 'SendModal',
  components: { ArkadeLogo, ContactAvatar, ProgressCta, QrScanSheet },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    // True while the parent (Wallet.onPaymentDetected) is fetching/validating
    // the destination after we emitted it. Drives the loading CTA so the user
    // sees that we are resolving the address, not guessing it.
    resolving: {
      type: Boolean,
      default: false
    },
    // Set by the parent when resolution fails (e.g. the Lightning address
    // doesn't exist). Shown inline in the field so the user can fix it without
    // ever leaving the sheet. Cleared on edit (update:resolveError).
    resolveError: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue', 'payment-detected', 'update:resolveError', 'open-batch-send'],
  setup() {
    const addressBookStore = useAddressBookStore();
    const walletStore = useWalletStore();
    return { addressBookStore, walletStore };
  },
  data() {
    return {
      isProcessing: false,
      // Child scan surface (QrScanSheet owns the platform split).
      scannerOpen: false,
      // Phone-first entry mode for the fiat-payout rails.
      mobileMoneyMode: false,
      // Explicitly chosen payout country (Mobile Money selector). null =
      // auto-detect from the typed number. Registry-driven options.
      mmCountry: null,
      payoutCountries: payoutCountryOptions(),
      manualInput: '',
      // First-open contact hydration (store.initialize reads localStorage).
      contactsLoading: false,
      // Payable string found on the clipboard at open (web peek only).
      clipboardSuggestion: null,
      // Sticky default for the ambiguous-country chooser: the payout country the
      // user last picked, so a bare (no calling code) number that is valid in
      // more than one country leads with their country. Ordering only — an
      // ambiguous number always still requires an explicit tap.
      preferredPayoutCountry: getPreferredPayoutCountry(),
    }
  },
  computed: {
    // Loading from the moment we submit (local isProcessing, covers our own
    // npub resolve + the QR decode) through the parent's fetch (resolving prop),
    // until the parent either closes us (success) or reports an error. One
    // flag drives the footer CTA everywhere.
    ctaBusy() {
      return this.isProcessing || this.resolving;
    },

    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      }
    },

    // Live detection mirrors AddressBookModal's pattern. We strip URI
    // wrappers (lightning:, bitcoin:) so a paste like
    // "lightning:lnbc1..." resolves to lightning_invoice rather than
    // the raw scheme.
    detectedInputType() {
      const raw = (this.manualInput || '').trim();
      if (!raw) return null;
      const lower = raw.toLowerCase();

      // BIP21 first — bitcoin:<addr>?... is structurally distinct and
      // we want the "Bitcoin (BIP21)" label even when the inner is an
      // on-chain address that would also pass isBitcoinAddress.
      if (lower.startsWith('bitcoin:')) {
        const parsed = parseBip21(raw);
        if (parsed) return 'bip21';
      }

      // http(s) "fallback URL" with the LNURL in a `lightning=` query param
      // (LNbits / Fossa ATMs) — surface it as LNURL while typing. Otherwise
      // strip a wrapper URI scheme (`lightning:` / `lnurl:`) off the raw paste.
      const lnFallback = extractLnFallbackParam(raw);
      const cleaned = lnFallback ? lnFallback : stripWrapperScheme(raw);

      if (isSparkAddress(cleaned)) return 'spark';
      if (isArkadeAddress(cleaned)) return 'arkade';
      if (isBolt12Offer(cleaned)) return 'bolt12_offer';
      if (isLightningInvoice(cleaned)) return 'lightning_invoice';
      // Bare Nostr key: `npub1…` / `nprofile1…` (optionally `nostr:`-prefixed).
      // Unambiguous — nothing else looks like this — so we resolve it to the
      // person's Lightning address. NIP-05 (`name@domain`) is intentionally
      // NOT matched here: it's indistinguishable from a Lightning Address, so
      // it stays on the Lightning-address rails (and is only Nostr-resolved as
      // a fallback if that lookup misses — see Wallet.onPaymentDetected).
      const nostrKind = classifyIdentifier(cleaned);
      if (nostrKind === 'npub' || nostrKind === 'nprofile') return 'nostr_identifier';
      if (isLightningAddress(cleaned)) return 'lightning_address';
      if (isLnurl(cleaned)) return 'lnurl';
      if (isBitcoinAddress(cleaned)) return 'bitcoin_address';
      // A bare phone number we can route to a fiat-payout provider
      // (Zambia → Bitzed, Kenya → Tando). Strict: only a complete, valid
      // KE/ZM mobile number matches, so partial digits never false-positive.
      if (this.recognizedPhone) return 'phone_number';
      return null;
    },

    detectedInputLabel() {
      // A resolved, unambiguous phone number names its destination country
      // (and operator when known) — stronger confirmation than a generic
      // "Phone number" before an irreversible fiat payout.
      if (this.detectedInputType === 'phone_number') {
        const phone = this.recognizedPhone;
        if (phone && !phone.ambiguous) {
          const c = phone.candidates?.[0] || phone;
          const cn = this.countryName(c.country.code);
          return c.operator ? `${cn} · ${c.operator}` : cn;
        }
        return this.$t('Phone number');
      }
      // Payment-language unification: every payable rail reads "Bitcoin" —
      // the chip's icon and color carry the nuance for expert eyes. Only
      // non-rail identities (a Nostr person) and the one unsupported
      // format we must name (BOLT12, so its error makes sense) differ.
      const labels = {
        spark: this.$t('Bitcoin'),
        bolt12_offer: this.$t('BOLT12 offer'),
        lightning_invoice: this.$t('Bitcoin'),
        lightning_address: this.$t('Bitcoin'),
        lnurl: this.$t('Bitcoin'),
        bitcoin_address: this.$t('Bitcoin'),
        bip21: this.$t('Bitcoin'),
        nostr_identifier: this.$t('Nostr profile')
      };
      return labels[this.detectedInputType] || '';
    },

    detectedInputIcon() {
      // The bolt is reserved for the one place it means something (the
      // unsupported-BOLT12 signal) — every payable rail carries the ₿
      // mark, matching the unified "Bitcoin" label. LNURL keeps the link
      // glyph (it is a link), phone and Nostr keep their identities.
      const icons = {
        bolt12_offer: 'tabler:bolt',
        lightning_invoice: 'tabler:currency-bitcoin',
        lightning_address: 'tabler:currency-bitcoin',
        lnurl: 'tabler:link',
        bitcoin_address: 'tabler:currency-bitcoin',
        bip21: 'tabler:currency-bitcoin',
        phone_number: 'tabler:device-mobile',
        nostr_identifier: 'tabler:user'
      };
      return icons[this.detectedInputType] || '';
    },

    isValidManualInput() {
      return !!this.detectedInputType;
    },

    // Live capability gate, computed off the same normalization the emit
    // uses. Non-empty = the active wallet can't ride this rail; the hint
    // shows in the field the moment the destination is recognized, the
    // CTA disables, and nothing is ever emitted — so a confirm sheet
    // that could only dead-end never opens.
    capabilityBlocked() {
      if (!this.isValidManualInput) return '';
      const paymentType = this.determinePaymentType(this.manualInput.trim());
      if (canWalletPay(this.walletStore.activeWalletType, paymentType)) return '';
      return walletSwitchHint(paymentType, this.$t.bind(this));
    },

    // Full phone-number recognition for the current input (or null). Drives
    // the 'phone_number' chip and the ambiguous-country chooser. With a
    // Mobile Money country picked, recognition locks to that country (which
    // also accepts the bare local number); an explicit foreign calling code
    // still wins over the lock — the typed +CC is the stronger signal.
    recognizedPhone() {
      const raw = (this.manualInput || '').trim();
      if (!raw) return null;
      const cleaned = raw.toLowerCase().startsWith('lightning:')
        ? raw.substring(10).trim()
        : raw;
      if (this.mobileMoneyMode && this.mmCountry) {
        return recognizePhoneNumberForCountry(this.mmCountry, cleaned)
          || recognizePhoneNumber(cleaned);
      }
      return recognizePhoneNumber(cleaned);
    },

    mmCountryOption() {
      return this.payoutCountries.find((c) => c.code === this.mmCountry) || null;
    },

    // True when the number is valid in more than one country (075-078 KE/ZM
    // overlap) and no calling code was given — the user must pick.
    phoneNeedsCountryChoice() {
      return this.detectedInputType === 'phone_number'
        && !!this.recognizedPhone
        && this.recognizedPhone.ambiguous === true;
    },

    // The ambiguous-country candidates, each enriched with its provider brand
    // logo and ordered so the user's last-chosen country leads (see
    // payoutCountryPreference). This is presentation only — selecting still
    // requires an explicit tap; we never auto-pick a country for an ambiguous
    // number because a wrong-country payout is irreversible.
    orderedPhoneCandidates() {
      const phone = this.recognizedPhone;
      if (!phone || !Array.isArray(phone.candidates)) return [];
      const preferred = this.preferredPayoutCountry;
      const ordered = [
        ...phone.candidates.filter((c) => c.country.code === preferred),
        ...phone.candidates.filter((c) => c.country.code !== preferred),
      ];
      return ordered.map((c) => {
        const brand = matchLnAddressService(c.lightningAddress);
        return { ...c, brandLogo: (brand && (brand.logo || brand.flag)) || '' };
      });
    },

    // Method rows (Mobile Money / Batch Send) show only on the resting sheet:
    // any typing hands their space to the contact filter or the preview card.
    showMethods() {
      return !this.mobileMoneyMode && !(this.manualInput || '').trim();
    },

    showContactsSection() {
      return !this.mobileMoneyMode && !this.isValidManualInput;
    },

    // The clipboard chip shows only on the resting sheet: any typing (or
    // Mobile Money mode) means the user has chosen their own path.
    showClipboardSuggestion() {
      return !!this.clipboardSuggestion
        && !this.mobileMoneyMode
        && !(this.manualInput || '').trim();
    },

    clipboardPreview() {
      const v = this.clipboardSuggestion?.value || '';
      if (v.length <= 30) return v;
      return `${v.slice(0, 18)}…${v.slice(-8)}`;
    },

    // Unrecognized text doubles as a contact search. Empty while the input
    // is a recognized payment format (the list is hidden then anyway).
    contactQuery() {
      if (this.mobileMoneyMode || this.isValidManualInput) return '';
      return (this.manualInput || '').trim().toLowerCase();
    },

    // Resting order: favorites, then recents, then everyone (alphabetical),
    // deduped. A query filters across ALL contacts by name or address.
    displayContacts() {
      const all = [...this.addressBookStore.entries]
        .sort((a, b) => a.name.localeCompare(b.name));
      const q = this.contactQuery;
      if (q) {
        return all.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          (c.address || c.lightningAddress || '').toLowerCase().includes(q)
        );
      }
      const seen = new Set();
      const ordered = [];
      for (const c of [
        ...this.addressBookStore.favoriteEntries,
        ...this.addressBookStore.recentEntries,
        ...all,
      ]) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          ordered.push(c);
        }
      }
      return ordered;
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.initContacts();
        this.peekClipboard();
      } else {
        this.resetState();
      }
    },
    // Smart fetching: ANY recognized destination auto-advances into the
    // resolve once the input settles — no Continue tap needed. Detection
    // is prefix-based, so the debounce is what makes this safe for typed
    // input: every keystroke re-arms it, and it only fires after the user
    // has stopped. Phone numbers get the shorter beat (the matcher only
    // accepts complete numbers, so a partial can never fire); addresses
    // and other formats wait slightly longer because a pause can land on
    // a valid intermediate string. Pasted content advances faster still
    // (see pasteFromClipboard) since it arrives complete. The confirm
    // sheet stays the review/commit gate either way — this fetches and
    // validates, it never sends.
    manualInput() {
      // Editing clears a stale "couldn't resolve" error from the previous try.
      if (this.resolveError) this.$emit('update:resolveError', '');
      clearTimeout(this.phoneAdvanceTimer);
      if (!this.isValidManualInput || this.phoneNeedsCountryChoice || this.capabilityBlocked) return;
      const settleMs = this.detectedInputType === 'phone_number' ? 700 : 900;
      this.phoneAdvanceTimer = setTimeout(() => this.autoAdvance(), settleMs);
    },
    // The parent flips `resolving` back to false the moment its fetch settles
    // (success OR failure, including notify-only paths) — clear the local
    // spinner so the CTA leaves "Fetching…". The field is always present on
    // this sheet, so failures stay inline; we never auto-close here (success
    // closes us from the parent).
    resolving(now, was) {
      if (was && !now) this.isProcessing = false;
    },
    // A failure message arriving. Clear the spinner here too: on a synchronous
    // throw the parent sets sendResolving true->false within one tick, so the
    // `resolving` watcher above never fires and the CTA would freeze.
    resolveError(message) {
      if (message) this.isProcessing = false;
    }
  },
  beforeUnmount() {
    clearTimeout(this.phoneAdvanceTimer);
    clearTimeout(this.pasteAdvanceTimer);
  },
  methods: {
    // Hydrate the address book on first open (idempotent — the store guards
    // itself). The skeleton only shows while entries are still empty, so a
    // warm store re-opens instantly.
    async initContacts() {
      if (this.addressBookStore.entries.length > 0) return;
      this.contactsLoading = true;
      try {
        await this.addressBookStore.initialize();
      } catch (e) {
        console.error('Failed to load contacts:', e);
      } finally {
        this.contactsLoading = false;
      }
    },

    // QDialog auto-focuses the first focusable element — here, the field —
    // which would pop the keyboard over the contact list on every open. The
    // resting sheet must open calm: focus only when the user taps the field
    // (or Paste / Mobile Money, which focus deliberately).
    onSheetShow() {
      this.$refs.manualTextarea?.blur();
    },

    /**
     * Clipboard peek on open — web only. Native platforms surface a
     * system "app pasted from your clipboard" notice on every
     * programmatic read (Android 12+ toast, iOS paste banner/prompt);
     * peeking on each open would fire it constantly, so there the
     * explicit Paste button remains the only clipboard access.
     *
     * The chip appears only for a string this wallet could actually
     * take further (recognized format, payable rail) — anything else
     * stays invisible. Tapping it is the explicit consent that starts
     * the resolve; nothing ever advances on its own.
     */
    async peekClipboard() {
      this.clipboardSuggestion = null;
      if (Capacitor.isNativePlatform()) return;
      if (!navigator.clipboard?.readText) return;
      try {
        const text = (await navigator.clipboard.readText() || '').trim();
        if (!text || text.length > 4096) return;
        if (!this.isSuggestibleDestination(text)) return;
        this.clipboardSuggestion = { value: text };
      } catch {
        // Permission denied / unavailable — no chip, no noise.
      }
    },

    /**
     * Would this string get somewhere if the user pasted it? Mirrors the
     * field's detection set (rails + Nostr identities + payout phone
     * numbers), minus BOLT12 (recognized but unpayable — suggesting it
     * would only advertise a dead end), and gated on the same wallet
     * capability check the field enforces.
     */
    isSuggestibleDestination(text) {
      const paymentType = this.determinePaymentType(text);
      if (paymentType === 'bolt12_offer') return false;
      if (paymentType !== 'unknown') {
        return canWalletPay(this.walletStore.activeWalletType, paymentType);
      }
      const nostrKind = classifyIdentifier(stripWrapperScheme(text));
      if (nostrKind === 'npub' || nostrKind === 'nprofile') return true;
      return !!recognizePhoneNumber(text);
    },

    applyClipboardSuggestion() {
      const value = this.clipboardSuggestion?.value;
      if (!value) return;
      this.clipboardSuggestion = null;
      if (this.resolveError) this.$emit('update:resolveError', '');
      this.manualInput = value;
      this.$nextTick(() => {
        this.$refs.manualTextarea?.focus();
      });
      // Same short beat the Paste button gives: a glimpse of what landed
      // in the field, then resolve — to the confirm sheet, never a send.
      clearTimeout(this.pasteAdvanceTimer);
      this.pasteAdvanceTimer = setTimeout(() => this.autoAdvance(), 300);
    },

    openScanner() {
      if (this.ctaBusy) return;
      if (this.resolveError) this.$emit('update:resolveError', '');
      this.scannerOpen = true;
    },

    async onQRDetect(qrContent) {
      if (this.isProcessing || !qrContent) return;

      // The scan sheet has already closed itself — land the decoded string
      // in the field, so the user always sees exactly what is being
      // resolved, and can edit it in place if resolution fails.
      this.manualInput = qrContent;

      this.isProcessing = true;

      try {
        await this.processPaymentData(qrContent);
      } catch (error) {
        console.error('QR processing error:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid QR code'),
          caption: this.$t('Please try a different code'),
        });
        this.isProcessing = false;
      }
    },

    async processPaymentData(paymentData) {
      try {
        const inputData = typeof paymentData === 'string'
          ? paymentData
          : (paymentData?.data || paymentData?.text || String(paymentData || ''));

        if (!inputData || inputData.trim().length === 0) {
          throw new Error(this.$t('Invalid payment data'));
        }

        let trimmedData = inputData.trim();

        // A recognized Kenyan/Zambian phone number is a fiat-payout destination
        // — resolve it to its provider Lightning Address (Zambia → @bitzed.xyz,
        // Kenya → @bitcoin.co.ke) up front, BEFORE the SA-retail QR check, whose
        // numeric codes would otherwise swallow a 10-digit phone number. The
        // built address then flows through the normal Lightning-address rails
        // (which brand it).
        const phone = recognizePhoneNumber(trimmedData);
        if (phone) {
          this.$emit('payment-detected', {
            data: phone.lightningAddress,
            type: 'lightning_address',
            rawInput: trimmedData,
          });
          return;
        }

        // Check for SA retailer QR codes (PnP, Checkers, Woolworths, etc.)
        if (isSARetailerQR(trimmedData)) {
          const result = convertToLightningAddress(trimmedData);
          if (result) {
            this.$emit('payment-detected', {
              data: result.lightningAddress,
              type: 'lightning_address',
              source: SA_RETAIL_SOURCE,
              merchant: result.merchant,
            });
            return;
          }
          const merchant = getMerchantInfo(trimmedData);
          this.$q.notify({
            type: 'warning',
            message: this.$t('SA Retailer QR detected'),
            caption: merchant
              ? `${merchant.displayName} - ${this.$t('not yet supported')}`
              : this.$t('This retailer is not yet supported'),
            timeout: 4000,
          });
          this.isProcessing = false;
          return;
        }

        // Resolve URI wrappers: strip `lightning:`, and for BIP21
        // (`bitcoin:<addr>?amount=...&lightning=lnbc...`) prefer the embedded
        // BOLT11 invoice over the on-chain address.
        const { cleaned: resolved, bip21 } = this.normalizePaymentInput(trimmedData);
        let cleanData = resolved;

        if (cleanData.includes('@') && cleanData.includes('.')) {
          cleanData = cleanData.toLowerCase();
        }

        // Bare Nostr key (npub / nprofile, optionally nostr:-prefixed): resolve
        // the person's profile to their Lightning address (lud16) or LNURL
        // (lud06) and pay that, carrying their name + avatar so the confirm
        // sheet shows who they are. The loading CTA is already up
        // (processManualInput / onQRDetect set isProcessing).
        const nostrKind = classifyIdentifier(cleanData);
        if (nostrKind === 'npub' || nostrKind === 'nprofile') {
          try {
            const target = await resolveNostrLightningTarget(cleanData, { timeoutMs: 8000 });
            this.$emit('payment-detected', {
              data: target.address,
              type: target.kind, // 'lightning_address' | 'lnurl'
              rawInput: trimmedData,
              nostrPubkey: target.pubkey,
              nostrNpub: target.npub,
              nostrProfile: target.profile,
            });
          } catch (err) {
            this.isProcessing = false;
            this.notifyNostrResolveError(err);
          }
          return;
        }

        const paymentType = this.determinePaymentType(cleanData);

        // Nothing we can route. Stop here instead of handing the parent a
        // payload it can only fail on. The string stays visible in the field
        // for inspection; the toast explains why nothing happened (this path
        // is practically scan-only — typing is gated by isValidManualInput).
        if (paymentType === 'unknown') {
          this.isProcessing = false;
          this.$q.notify({
            type: 'negative',
            message: this.$t("We don't recognize this code"),
            caption: this.$t("It doesn't look like a payment request"),
            timeout: 4000,
          });
          return;
        }

        // Capability backstop for payloads that bypass the field guards
        // (scans land here directly): never emit a destination the active
        // wallet can't pay — the parent could only dead-end on it. The
        // scanned string is in the field, so the reactive capability hint
        // (capabilityBlocked) is already explaining the switch.
        if (!canWalletPay(this.walletStore.activeWalletType, paymentType)) {
          this.isProcessing = false;
          return;
        }

        this.$emit('payment-detected', {
          data: cleanData,
          type: paymentType,
          // Original, un-normalized input. Branta needs this for on-chain
          // verification because the ZK params (branta_id / branta_secret)
          // live in the bitcoin: URI query string, which normalization
          // strips out of `data`.
          rawInput: trimmedData,
          ...(bip21 ? { bip21 } : {})
        });
        // No closeModal here: we stay open showing the loading CTA while the
        // parent fetches/validates the destination. It closes us on success,
        // or pushes an inline error back via :resolve-error on failure.
      } catch (error) {
        throw error;
      }
    },

    /**
     * Map a Nostr-resolution failure to a friendly notification. The error's
     * `.code` distinguishes "profile has no Lightning address" from "couldn't
     * find / reach the profile" so the user knows whether to fix the npub or
     * just retry.
     */
    notifyNostrResolveError(err) {
      const code = err?.code;
      let message = this.$t("We couldn't resolve this Nostr profile");
      let caption = this.$t('Check the npub and your connection, then try again');
      if (code === NOSTR_TARGET_ERROR.NO_ADDRESS) {
        message = this.$t('This Nostr profile has no Lightning address yet');
        caption = this.$t('Ask them to set a Lightning address on their profile');
      } else if (code === NOSTR_TARGET_ERROR.NO_PROFILE) {
        message = this.$t("We couldn't find this Nostr profile");
        caption = this.$t('No profile was published to the relays we checked');
      } else if (code === LOOKUP_ERROR.INVALID_NPUB || code === LOOKUP_ERROR.INVALID_NPROFILE) {
        message = this.$t('That Nostr key looks malformed');
        caption = this.$t('Double-check the npub and try again');
      }
      this.$q.notify({ type: 'negative', message, caption });
    },

    /**
     * Unwrap URI schemes to the inner payment destination.
     *
     * - `lightning:<...>`      → strip prefix
     * - `bitcoin:<addr>?...`   → parse BIP21, prefer embedded `lightning=`
     *                            invoice over on-chain address
     */
    normalizePaymentInput(input) {
      const trimmed = (input || '').trim();

      const bip21 = parseBip21(trimmed);
      if (bip21) {
        const destination = selectBip21Destination(bip21);
        return { cleaned: destination ? destination.value : '', bip21 };
      }

      // http(s) "fallback URL" carrying the LNURL in a `lightning=` query param
      // (LNbits / Fossa ATMs). Pull out the bare LNURL/invoice so the
      // recognizers downstream can classify it.
      const lnFallback = extractLnFallbackParam(trimmed);
      if (lnFallback) {
        return { cleaned: lnFallback, bip21: null };
      }

      // Otherwise unwrap a `lightning:` / `lnurl:` scheme down to the bare
      // payload so the type classifier and the emitted value are both
      // wrapper-free. No-op when no wrapper is present.
      return { cleaned: stripWrapperScheme(trimmed), bip21: null };
    },

    determinePaymentType(data) {
      const { cleaned } = this.normalizePaymentInput(data);
      if (!cleaned) return 'unknown';

      if (isSparkAddress(cleaned)) return 'spark_address';
      if (isArkadeAddress(cleaned)) return 'arkade_address';
      if (isBolt12Offer(cleaned)) return 'bolt12_offer';
      if (isLightningInvoice(cleaned)) return 'lightning_invoice';
      if (isLightningAddress(cleaned)) return 'lightning_address';
      if (isLnurl(cleaned)) return 'lnurl';
      if (isBitcoinAddress(cleaned)) return 'bitcoin_address';
      return 'unknown';
    },

    async pasteFromClipboard() {
      let clipboardText = '';

      // Modern Clipboard API
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          clipboardText = await navigator.clipboard.readText();
        } catch (e) {
          console.warn('clipboard.readText() failed:', e);
        }
      }

      // Some Android WebViews block readText() but allow read()
      if (!clipboardText && navigator.clipboard && navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              clipboardText = await blob.text();
              break;
            }
          }
        } catch (e) {
          console.warn('clipboard.read() failed:', e);
        }
      }

      // Always land the clipboard in the visible field for the user to
      // verify before committing. No silent fire-and-forget — too easy
      // to send to a stale or wrong address otherwise.
      this.manualInput = (clipboardText || '').trim();
      this.$nextTick(() => {
        this.$refs.manualTextarea?.focus();
      });

      // Pasted content is complete, so fetch directly once it's recognized
      // (any type) — a short beat lets the user glimpse what was pasted.
      clearTimeout(this.pasteAdvanceTimer);
      if (this.manualInput) {
        this.pasteAdvanceTimer = setTimeout(() => this.autoAdvance(), 300);
      }

      if (!clipboardText) {
        this.$q.notify({
          type: 'info',
          message: this.$t('Paste into the input field'),
          caption: this.$t('Long-press the text field and tap Paste'),
          timeout: 4000,
        });
      }
    },

    onTextareaPaste() {
      clearTimeout(this.pasteAdvanceTimer);
      this.pasteAdvanceTimer = setTimeout(() => this.autoAdvance(), 200);
    },

    enterMobileMoney() {
      this.mobileMoneyMode = true;
      this.manualInput = '';
      // Never pre-select a country — a remembered choice would silently
      // resolve the KE/ZM 07x collision, and a wrong-country payout is
      // irreversible. Locking a country is always an explicit tap.
      this.mmCountry = null;
      if (this.resolveError) this.$emit('update:resolveError', '');
      this.$nextTick(() => {
        this.$refs.manualTextarea?.focus();
      });
    },

    exitMobileMoney() {
      this.mobileMoneyMode = false;
      this.manualInput = '';
      this.mmCountry = null;
      if (this.resolveError) this.$emit('update:resolveError', '');
    },

    // Tap toggles: selecting locks recognition to the country, tapping the
    // active chip returns to auto-detect. A complete number plus an explicit
    // country is a full destination — advance without further ceremony.
    selectMmCountry(code) {
      this.mmCountry = this.mmCountry === code ? null : code;
      this.$nextTick(() => {
        this.$refs.manualTextarea?.focus();
        this.autoAdvance();
      });
    },

    // Batch send lives on the wallet page (BatchSendModal) — hand off and
    // get out of the way.
    openBatchSend() {
      this.show = false;
      this.$emit('open-batch-send');
    },

    goToAddressBook() {
      this.show = false;
      this.$router.push('/address-book');
    },

    onContactPicked(contact) {
      // Identity-only Nostr contact — saved, but no Lightning address
      // published yet. Explain instead of emitting a payment the send
      // flow can't complete.
      if (contact.source === 'nostr' && !this.addressBookStore.isEntryPayable(contact)) {
        this.$q.notify({
          type: 'info',
          message: this.$t('No Lightning address yet'),
          caption: this.$t(
            "{name} hasn't published a Lightning address. Open Address Book to check again later.",
            { name: contact.name },
          ),
          timeout: 4500,
        });
        return;
      }

      const address = this.getContactAddress(contact);
      const addressType = this.getContactAddressType(contact);

      // Defensive — block payment paths the active wallet can't satisfy,
      // with the same switch hint every other surface shows.
      if (!canWalletPay(this.walletStore.activeWalletType, addressType)) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Cannot pay this contact'),
          caption: walletSwitchHint(addressType, this.$t.bind(this)),
          timeout: 3500,
        });
        return;
      }

      const paymentTypeMap = {
        spark: 'spark_address',
        arkade: 'arkade_address',
        bitcoin: 'bitcoin_address',
        lightning: 'lightning_address',
        // LNURL contacts emit the same payment type the manual/scan LNURL path
        // uses, so Wallet.onPaymentDetected resolves them via fetchLNURLInfo.
        lnurl: 'lnurl'
      };
      const paymentType = paymentTypeMap[addressType] || 'lightning_address';

      // Feed the recents ordering the resting list leads with.
      this.addressBookStore.updateLastUsed(contact.id);

      // Land the address in the field: the user sees exactly what is being
      // resolved, and a failure leaves it editable in place.
      this.manualInput = address;
      this.isProcessing = true;
      this.$emit('payment-detected', {
        data: address,
        type: paymentType
      });
      // Parent closes us on success / surfaces an inline error on failure.
    },

    // Contact helpers (used by the contact-row handler above).
    getContactAddress(contact) {
      return this.addressBookStore.getEntryAddress(contact);
    },

    getContactAddressType(contact) {
      return this.addressBookStore.getEntryAddressType(contact);
    },

    /**
     * Rail dot for a contact row — only the constrained rails get one
     * (a Lightning/LNURL contact is the norm and stays undecorated).
     * Colors mirror the quick-contacts modal so the vocabulary matches.
     */
    contactRailDot(contact) {
      const type = this.getContactAddressType(contact);
      if (type === 'spark') return { kind: 'spark', color: '#000' };
      if (type === 'arkade') return { kind: 'arkade', color: '#F14317' };
      if (type === 'bitcoin') return { kind: 'bitcoin', color: '#F7931A' };
      return null;
    },

    // Payable = has a resolvable address (identity-only Nostr contacts
    // don't yet) AND rides a rail the active wallet can pay. Drives the
    // dimmed row state; the tap guards in onContactPicked explain why.
    isContactPayable(contact) {
      if (contact.source === 'nostr' && !this.addressBookStore.isEntryPayable(contact)) return false;
      return canWalletPay(this.walletStore.activeWalletType, this.getContactAddressType(contact));
    },

    countryName(code) {
      return { KE: this.$t('Kenya'), ZM: this.$t('Zambia'), TZ: this.$t('Tanzania') }[code] || code;
    },

    // Ambiguous-number chooser: emit the picked country's constructed address
    // directly, bypassing the default-country resolution in processPaymentData.
    selectPhoneCountry(candidate) {
      if (!candidate) return;
      // Remember the choice so the chooser leads with this country next time.
      this.preferredPayoutCountry = candidate.country.code;
      rememberPayoutCountry(candidate.country.code);
      // Keep the sheet open with the loading CTA while the parent resolves the
      // constructed provider address; it closes us on success.
      this.isProcessing = true;
      this.$emit('payment-detected', {
        data: candidate.lightningAddress,
        type: 'lightning_address',
        rawInput: this.manualInput.trim(),
      });
    },

    // Auto-advance (smart fetching) entry point used by the input watcher
    // and the paste hooks. Guarded so a pending timer never fires after the
    // sheet was closed, edited to something invalid, a send is in flight,
    // an ambiguous number still needs a KE/ZM choice, or a resolve already
    // failed for exactly this input (editing clears the error and re-arms).
    autoAdvance() {
      if (this.show && !this.isProcessing && !this.resolveError && this.isValidManualInput
          && !this.phoneNeedsCountryChoice && !this.capabilityBlocked) {
        this.processManualInput();
      }
    },

    async processManualInput() {
      if (!this.isValidManualInput || this.ctaBusy || this.capabilityBlocked) return;

      // Resolved Mobile Money number: it is already bound to one provider
      // address, so emit that directly. Re-deriving in processPaymentData
      // would re-apply the ambiguous-country default and could flip a
      // country-locked number to the wrong corridor.
      const phone = this.mobileMoneyMode ? this.recognizedPhone : null;
      if (phone && !phone.ambiguous) {
        this.preferredPayoutCountry = phone.country.code;
        rememberPayoutCountry(phone.country.code);
        this.isProcessing = true;
        this.$emit('payment-detected', {
          data: phone.lightningAddress,
          type: 'lightning_address',
          rawInput: this.manualInput.trim(),
        });
        return;
      }

      // Keep the sheet OPEN and swap the CTA for the loading button — the
      // fetch/validation happens here (and in the parent) before we ever
      // leave this field, so a bad address surfaces inline instead of failing
      // later. The parent closes the sheet once the destination is resolved.
      this.isProcessing = true;

      try {
        await this.processPaymentData(this.manualInput.trim());
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid payment request'),
          caption: this.$t('Please check the format and try again'),
        });
        this.isProcessing = false;
      }
    },

    closeModal() {
      this.show = false;
    },

    resetState() {
      clearTimeout(this.phoneAdvanceTimer);
      clearTimeout(this.pasteAdvanceTimer);
      this.isProcessing = false;
      this.manualInput = '';
      this.mobileMoneyMode = false;
      this.mmCountry = null;
      this.scannerOpen = false;
      this.clipboardSuggestion = null;
      // Clear any inline resolve error so a fresh open starts clean.
      if (this.resolveError) this.$emit('update:resolveError', '');
    }
  }
}
</script>

<style scoped>
.send-sheet-dialog :deep(.q-dialog__inner) {
  padding: 0;
}

.send-sheet-dialog :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* ─────────────────────────────────────────────────────────────
   Sheet shell
   Content-sized bottom sheet: it hugs whatever state is showing
   (compact for Mobile Money / a recognized destination, tall only
   when the contact list earns the height) and never opens a void
   of dead space. Cap in dvh where supported so the keyboard resize
   keeps the footer visible; the contact list is the one scroll
   region once the cap is hit.
   ───────────────────────────────────────────────────────────── */
.send-sheet {
  width: 100%;
  max-width: 520px;
  max-height: min(86vh, calc(100vh - var(--safe-top, 0px) - 12px));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-card);
  font-family: 'Manrope', sans-serif;
  position: relative;
}

@supports (height: 1dvh) {
  .send-sheet {
    max-height: min(86dvh, calc(100dvh - var(--safe-top, 0px) - 12px));
  }
}

.send-sheet-dark {
  box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.55);
}

.send-sheet-light {
  border-top: 1px solid var(--border-card);
  box-shadow: 0 -20px 50px rgba(40, 34, 20, 0.12);
}

.grab-bar {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--text-muted);
  opacity: 0.45;
  margin: 8px auto 0;
  flex-shrink: 0;
}

.sheet-close {
  position: absolute;
  top: 8px;
  right: 10px;
  width: 30px;
  height: 30px;
  color: var(--text-muted);
  z-index: 2;
}

.mm-head {
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 2px 52px 0 8px;
  gap: 2px;
  flex-shrink: 0;
}

.mm-back {
  width: 34px;
  height: 34px;
  color: var(--text-secondary);
}

.mm-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

/* ─────────────────────────────────────────────────────────────
   Entry field
   ───────────────────────────────────────────────────────────── */
.entry-block {
  /* Top padding clears the floating close button — the sheet is
     deliberately headerless (grab bar + field, no title noise). */
  padding: 30px 20px 0;
  flex-shrink: 0;
}

.mm-head + .entry-block {
  padding-top: 10px;
}

/* Clipboard suggestion chip — quiet card above the field. The value
   reads as data (mono, middle-truncated); the accent "Paste" tag names
   the action. */
.clip-suggest {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px dashed var(--border-card);
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  transition: background-color 0.15s ease, transform 0.08s ease;
}

.body--dark .clip-suggest {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
}

.clip-suggest:hover { background: rgba(17, 24, 39, 0.05); }
.body--dark .clip-suggest:hover { background: rgba(255, 255, 255, 0.08); }
.clip-suggest:active { transform: scale(0.99); }

.clip-suggest-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.clip-suggest-text {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono), 'Manrope', sans-serif;
  font-size: 12.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-suggest-cta {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.body--dark .clip-suggest-cta {
  background: rgba(21, 222, 114, 0.16);
  color: #15DE72;
}

.manual-textarea {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: var(--font-mono), 'Manrope', sans-serif;
  font-size: 16px; /* ≥16px so iOS never zooms the sheet on focus */
  line-height: 1.45;
  outline: none;
  resize: none;
  transition: border-color 0.18s ease;
  word-break: break-all;
}

.manual-textarea:focus {
  border-color: var(--color-green);
}

.body--light .manual-textarea:focus {
  border-color: var(--text-primary);
}

.manual-textarea--error,
.manual-textarea--error:focus {
  border-color: rgba(239, 68, 68, 0.55);
}

.manual-textarea::placeholder {
  color: var(--text-muted);
  font-family: 'Manrope', sans-serif;
}

.field-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 24px;
  padding: 4px 2px 0;
}

.input-helper {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--text-muted);
  min-width: 0;
}

.helper-icon-error {
  color: #EF4444;
  flex-shrink: 0;
}

/* Whole helper row turns red when showing a resolution error so the
   message (e.g. "We couldn't find this Lightning address") reads clearly. */
.input-helper--error {
  color: #EF4444;
}

/* Capability hint (amber, not red): the destination is valid, the wallet
   just rides a different rail — a constraint, not a failure. */
.helper-icon-warn {
  color: #B45309;
  flex-shrink: 0;
}

.input-helper--warn {
  color: #B45309;
}

.body--dark .helper-icon-warn,
.body--dark .input-helper--warn {
  color: #F59E0B;
}

/* Auto-detection chip — same vocabulary as AddressBookModal so users
   recognize the affordance across surfaces. */
.detected-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Light mode runs neutral (near-black on soft grey) — Buho green is a
   deliberate accent, not the default chrome. Dark mode keeps the green
   family below, where it reads calm instead of loud. */
.detected-pill--lightning_address,
.detected-pill--lightning_invoice,
.detected-pill--lnurl,
.detected-pill--phone_number,
.detected-pill--nostr_identifier {
  background: rgba(17, 24, 39, 0.06);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.14);
}

.body--dark .detected-pill--lightning_address,
.body--dark .detected-pill--lightning_invoice,
.body--dark .detected-pill--lnurl,
.body--dark .detected-pill--phone_number,
.body--dark .detected-pill--nostr_identifier {
  background: rgba(21, 222, 114, 0.16);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.28);
}

.detected-pill--spark,
.detected-pill--arkade,
.detected-pill--bolt12_offer {
  background: rgba(120, 120, 120, 0.12);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px rgba(120, 120, 120, 0.25);
}

.detected-pill--bitcoin_address,
.detected-pill--bip21 {
  background: rgba(247, 147, 26, 0.14);
  color: #C97A0F;
  box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.28);
}

.body--dark .detected-pill--bitcoin_address,
.body--dark .detected-pill--bip21 {
  color: #F7931A;
  box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.36);
}

.type-pill-enter-active,
.type-pill-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.type-pill-enter-from,
.type-pill-leave-to {
  opacity: 0;
  transform: translateY(-2px) scale(0.96);
}

/* ─────────────────────────────────────────────────────────────
   Mobile Money country selector
   ───────────────────────────────────────────────────────────── */
.mm-countries {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  /* Bottom inset carries the safe area for the (footer-less) resting
     Mobile Money state, so the sheet ends cleanly at the chips. */
  padding: 14px 20px max(16px, var(--safe-bottom, 16px));
  flex-shrink: 0;
}

.mm-country {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  transition: box-shadow 0.15s ease, background-color 0.15s ease,
    border-color 0.15s ease, transform 0.08s ease;
}

.body--dark .mm-country {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.mm-country:active {
  transform: scale(0.97);
}

/* Light mode: selection reads as near-black, not green. */
.mm-country--active {
  border-color: var(--text-primary);
  box-shadow: 0 0 0 1px var(--text-primary);
  background: rgba(17, 24, 39, 0.04);
}

.body--dark .mm-country--active {
  border-color: #15DE72;
  box-shadow: 0 0 0 1px #15DE72;
  background: rgba(21, 222, 114, 0.10);
}

.mm-country-logo {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  background: #fff;
}

.mm-country-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}

.mm-country-cc {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* ─────────────────────────────────────────────────────────────
   Paste / Scan
   ───────────────────────────────────────────────────────────── */
.quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 12px 20px 2px;
  flex-shrink: 0;
}

.quick-btn {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  box-shadow: inset 0 0 0 1px var(--border-card);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  transition: background-color 0.18s ease, transform 0.08s ease;
}

.body--dark .quick-btn {
  background: rgba(255, 255, 255, 0.06);
  box-shadow: none;
  color: rgba(255, 255, 255, 0.88);
}

.quick-btn:hover {
  background: rgba(17, 24, 39, 0.05);
}

.body--dark .quick-btn:hover {
  background: rgba(255, 255, 255, 0.10);
}

.quick-btn:active {
  transform: scale(0.97);
}

.quick-icon {
  opacity: 0.8;
}

/* ─────────────────────────────────────────────────────────────
   Resolving skeleton — the confirm sheet's recipient hero, forming
   ───────────────────────────────────────────────────────────── */
.resolve-skeleton {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 20px 2px;
  flex-shrink: 0;
}

.resolve-skeleton-lines {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
  min-width: 0;
}

/* ─────────────────────────────────────────────────────────────
   Method rows (Mobile Money / Batch Send)
   ───────────────────────────────────────────────────────────── */
.method-block {
  margin: 14px 20px 0;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-card);
  overflow: hidden;
  flex-shrink: 0;
}

.body--dark .method-block {
  border-color: rgba(255, 255, 255, 0.08);
}

.method-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.method-row:hover {
  background: rgba(17, 24, 39, 0.04);
}

.body--dark .method-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.method-row:active {
  background: rgba(17, 24, 39, 0.07);
}

.body--dark .method-row:active {
  background: rgba(255, 255, 255, 0.08);
}

.method-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-input);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.body--dark .method-icon {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.75);
}

.method-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.method-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
}

.method-sub {
  font-size: 12.5px;
  color: var(--text-muted);
}

.method-chev {
  color: var(--text-muted);
  flex-shrink: 0;
}

.method-divider {
  height: 1px;
  margin-left: 66px;
  background: var(--border-card);
}

.body--dark .method-divider {
  background: rgba(255, 255, 255, 0.07);
}

/* ─────────────────────────────────────────────────────────────
   Contacts
   ───────────────────────────────────────────────────────────── */
.contacts-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding-top: 6px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px 4px;
  flex-shrink: 0;
}

.section-label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.manage-btn {
  border: none;
  background: transparent;
  padding: 4px 2px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #15DE72;
  cursor: pointer;
}

/* Light mode: neutral near-black action, per the light-palette rule
   (green stays a dark-mode accent). */
.body--light .manage-btn {
  color: var(--text-primary);
}

.contacts-scroll {
  flex: 1;
  /* Floor keeps the sheet height steady while typing filters the list —
     rows disappearing must not make the whole sheet pump up and down. */
  min-height: 240px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 2px 8px max(14px, var(--safe-bottom, 14px));
}

.contact-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 14px;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.contact-row:hover {
  background: rgba(17, 24, 39, 0.04);
}

.body--dark .contact-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.contact-row:active {
  background: rgba(17, 24, 39, 0.07);
}

.body--dark .contact-row:active {
  background: rgba(255, 255, 255, 0.08);
}

.row-avatar-wrap {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
}

.row-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Rail dot — bottom-right of the avatar, ringed so it reads over any
   avatar color. Icon-only: the nuance without the jargon. */
.row-rail-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 0 0 2px var(--bg-card);
}

/* Unpayable on the active wallet (or identity-only Nostr contact):
   visibly dimmed; the tap still explains why via the shared toast. */
.contact-row--unpayable {
  opacity: 0.45;
}

.row-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-star {
  color: #F59E0B;
  flex-shrink: 0;
}

.row-chev {
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Skeleton + empty states */
.contacts-skeleton {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 12px;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.contacts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 36px 24px;
  gap: 4px;
}

.empty-icon {
  color: var(--text-muted);
  opacity: 0.7;
  margin-bottom: 4px;
}

.empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}

.empty-sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.45;
}

.empty-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 9px 16px;
  border: none;
  border-radius: 999px;
  background: var(--bg-input);
  box-shadow: inset 0 0 0 1px var(--border-card);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.body--dark .empty-add-btn {
  background: rgba(255, 255, 255, 0.07);
  box-shadow: none;
  color: rgba(255, 255, 255, 0.88);
}

/* ─────────────────────────────────────────────────────────────
   Footer (loading CTA / country chooser / Continue)
   ───────────────────────────────────────────────────────────── */
.sheet-footer {
  padding: 12px 20px max(14px, var(--safe-bottom, 14px));
  flex-shrink: 0;
}

/* Ambiguous-country chooser: a bare (no calling code) 07x number can be a
   valid mobile in more than one country. We never guess (wrong country is
   irreversible) — instead we show rich, one-tap rows (provider logo, country,
   operator, international number) with the user's last-picked country first. */
.country-choice { display: flex; flex-direction: column; gap: 8px; }
.country-choice-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: center;
}
.country-choice-list { display: flex; flex-direction: column; gap: 8px; }
.country-choice-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-card);
  background: var(--bg-input);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  transition: filter 0.15s ease, transform 0.08s ease;
}
.country-choice-btn:hover { filter: brightness(1.03); }
.country-choice-btn:active { transform: scale(0.99); }
.country-choice-logo {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: #fff;
}
.country-choice-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.country-choice-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.country-choice-op { font-size: 11.5px; color: var(--text-secondary); }
.country-choice-number {
  font-size: 12.5px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Primary CTA — gradient-green on dark, neutral-dark pill on cream.
   Same language as PaymentConfirmSheet, AddressBookModal, etc. */
.primary-cta {
  width: 100%;
  /* Match ProgressCta's height so the idle CTA -> loading-button morph doesn't
     jump (ProgressCta is 56px, 50px under 480px — mirrored below). */
  height: 56px;
  border-radius: var(--radius-pill);
  border: none;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  background: var(--gradient-green);
  color: #fff;
  transition: filter 0.15s ease, transform 0.08s ease, opacity 0.15s ease;
}

.body--light .primary-cta {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
}

.primary-cta:hover:not(:disabled) {
  filter: brightness(1.05);
}

.primary-cta:active:not(:disabled) {
  transform: scale(0.985);
  filter: brightness(0.95);
}

.primary-cta:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 480px) {
  /* Mirror ProgressCta's mobile height so the CTA morph stays seamless. */
  .primary-cta {
    height: 50px;
  }

  .entry-block,
  .quick-actions,
  .sheet-footer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .method-block,
  .resolve-skeleton {
    margin-left: 16px;
    margin-right: 16px;
  }

  .section-head {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
