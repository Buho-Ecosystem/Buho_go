<template>
  <q-page class="transaction-details-page">
    <!-- Header -->
    <div class="page-header">
      <q-btn
        flat
        round
        dense
        @click="$router.back()"
        class="back-btn"
      >
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="header-title">
        {{ $t('Transaction Details') }}
      </div>
      <div class="header-actions">
        <q-btn
          flat
          round
          dense
          @click="shareTransaction"
          class="share-btn"
        >
          <Icon icon="tabler:share" width="20" height="20" style="color: var(--text-secondary)" />
          <q-tooltip>{{ $t('Share') }}</q-tooltip>
        </q-btn>
        <q-btn
          flat
          round
          dense
          @click="toggleDeveloperMode"
          :class="['dev-toggle', { 'dev-active': showDeveloperMode }]"
        >
          <Icon
            icon="tabler:code"
            width="20"
            height="20"
            :class="showDeveloperMode ? 'dev-icon-active' : 'dev-icon-muted'"
          />
          <div v-if="showDeveloperMode" class="dev-active-dot"></div>
          <q-tooltip>{{ showDeveloperMode ? $t('Hide') : $t('Show') }} {{ $t('Developer Details') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Skeleton Loading State -->
    <div v-if="loading">
      <!-- Hero Card skeleton -->
      <div class="transaction-hero">
        <div class="hero-card">
          <div class="hero-content">
            <q-skeleton type="circle" size="56px" animation="wave" style="margin-bottom: 10px;" />
            <q-skeleton type="text" width="140px" height="30px" animation="wave" />
            <q-skeleton type="text" width="90px" height="15px" animation="wave" style="margin-top: 6px;" />
            <q-skeleton type="text" width="70px" height="22px" animation="wave" style="margin-top: 10px; border-radius: 999px;" />
          </div>
        </div>
      </div>

      <!-- Detail Fields skeleton -->
      <div class="details-section">
        <div class="tx-table">
          <div v-for="n in 3" :key="'detail-skel-'+n" class="tx-row">
            <q-skeleton type="text" width="30%" height="12px" animation="wave" />
            <q-skeleton type="text" width="40%" height="14px" animation="wave" />
          </div>
        </div>
      </div>
    </div>

    <!-- Transaction Details -->
    <div v-else-if="transaction" class="transaction-content">
      <!-- Transaction Hero Card -->
      <div class="transaction-hero">
        <div class="hero-card">
          <!-- Hero Content: centered column - direction icon, signed amount,
               fiat value, status pill. The counterparty row in the table
               below carries the "who", so the type label isn't repeated here. -->
          <div class="hero-content">
            <!-- A Learn & Earn reward carries the BuhoGO mark, but only when
                 the user hasn't assigned a counterparty of their own. Plain
                 <img>: ContactAvatar's picture prop only accepts https/data
                 URLs, not a root-relative asset path. -->
            <span class="hero-avatar-wrap">
              <span v-if="isEarnReward && !heroAvatar" class="hero-avatar hero-avatar-earn">
                <img :src="earnBrandLogo" class="hero-earn-logo" alt="" aria-hidden="true" />
              </span>
              <ContactAvatar
                v-else-if="heroAvatar"
                class="hero-avatar"
                :entry="heroAvatar.entry"
                :picture="heroAvatar.picture"
                :name="heroAvatar.name"
                :initial-length="2"
              />
              <!-- No known identity: the app-wide silhouette — the same
                   avatar-first anatomy as the transaction list, with the
                   movement-type badge carrying direction. -->
              <ContactAvatar
                v-else
                class="hero-avatar"
                :entry="{ address: getCounterpartyAddress() }"
              />
              <span
                v-if="heroBadge"
                class="hero-type-badge"
                :class="heroBadge.cls"
              >
                <Icon :icon="heroBadge.icon" width="12" height="12" />
              </span>
            </span>

            <div class="hero-amount" :class="getAmountClass()">
              {{ getFormattedAmount() }}
            </div>

            <!-- The fiat line prefers the value at settlement time (the rate
                 this payment actually happened at); today's rate is only
                 the fallback estimate. -->
            <div class="hero-fiat">
              <q-skeleton v-if="loadingFiatRates && !transaction.fiatAtSettlement" type="text" width="60px" height="14px" style="margin: 0 auto;" />
              <template v-else-if="transaction.fiatAtSettlement">
                {{ formatFiatValue(transaction.fiatAtSettlement.amount, transaction.fiatAtSettlement.currency) }} {{ $t('at settlement') }}
              </template>
              <template v-else>{{ getFiatAmount() }}</template>
            </div>

            <div class="hero-status-chip" :class="getStatusClass()">
              <Icon :icon="getStatusIcon()" width="12" height="12"/>
              {{ getTransactionStatus() }}
            </div>
          </div>
        </div>
      </div>

      <!-- Transaction Info -->
      <div class="details-section">
        <div class="tx-table">
          <div v-if="getCounterpartyAddress()" class="tx-row">
            <div class="tx-row-label">{{ transaction.type === 'outgoing' ? $t('To') : $t('Paid to') }}</div>
            <div class="tx-row-value">{{ getCounterpartyAddress() }}</div>
          </div>

          <!-- Branta merchant verification, carried over from the confirm
               sheet's badge — same trust signal, now on the receipt. -->
          <div
            v-if="merchantVerification"
            class="tx-row"
            :class="{ 'tx-row-clickable': merchantVerification.verifyUrl }"
            @click="openMerchantVerifyUrl"
          >
            <div class="tx-row-label">{{ $t('Verified by Branta') }}</div>
            <div class="tx-row-value tx-row-value-verified">
              <Icon icon="tabler:rosette-discount-check-filled" width="14" height="14" class="verified-row-icon" />
              <span>{{ merchantVerification.name || $t('Verified merchant') }}</span>
            </div>
          </div>

          <!-- How this payment was made, when an auxiliary path stamped a
               source (internal transfer, batch send, kiosk sale). -->
          <div v-if="txTypeRowText" class="tx-row">
            <div class="tx-row-label">{{ $t('Type') }}</div>
            <div class="tx-row-value">{{ txTypeRowText }}</div>
          </div>

          <!-- Created + Settled as separate timestamps when the provider
               reports both; a single combined row otherwise. -->
          <template v-if="transaction.created_at && transaction.settled_at && transaction.created_at !== transaction.settled_at">
            <div class="tx-row">
              <div class="tx-row-label">{{ $t('Created') }}</div>
              <div class="tx-row-value">{{ formatPreciseDateTime(transaction.created_at) }}</div>
            </div>
            <div class="tx-row">
              <div class="tx-row-label">{{ $t('Settled') }}</div>
              <div class="tx-row-value">{{ formatPreciseDateTime(transaction.settled_at) }}</div>
            </div>
          </template>
          <div v-else class="tx-row">
            <div class="tx-row-label">{{ $t('Date & Time') }}</div>
            <div class="tx-row-value">{{ formatDateTime(transaction.settled_at) }}</div>
          </div>

          <div v-if="isBitcoinTransaction()" class="tx-row">
            <div class="tx-row-label">{{ $t('Network') }}</div>
            <div class="tx-row-value">{{ $t('Bitcoin L1 (on-chain)') }}</div>
          </div>

          <!-- A reward's description is the untranslated brand memo, which
               the Type row above already states in the user's language. -->
          <div v-if="getTransactionDescription() && !isEarnReward" class="tx-row">
            <div class="tx-row-label">{{ $t('Description') }}</div>
            <div class="tx-row-value">{{ getTransactionDescription() }}</div>
          </div>

          <div v-if="transaction.memo && transaction.memo !== getTransactionDescription()" class="tx-row">
            <div class="tx-row-label">{{ $t('Memo') }}</div>
            <div class="tx-row-value">{{ transaction.memo }}</div>
          </div>

          <div v-if="getExtraComment()" class="tx-row">
            <div class="tx-row-label">{{ $t('Comment') }}</div>
            <div class="tx-row-value">&#8220;{{ getExtraComment() }}&#8221;</div>
          </div>

          <!--
            Fee + total breakdown for outgoing payments with a fee.

            The hero shows what the recipient actually received (the
            amount the user typed). These two rows explain what was
            added on top: the SSP/network fee, and the resulting
            total deducted from the wallet. Together they make the
            balance change reconcile without any mental math.

            Spark-to-Spark transfers carry no fee → both rows hide.
            Incoming flows fall through to the single Fee row below
            for now (informational only) — separate change.
          -->
          <template v-if="showFeeBreakdown">
            <div class="tx-row">
              <div class="tx-row-label">{{ $t('Network Fee') }}</div>
              <div class="tx-row-value">{{ formatAmount(transaction.fee, walletStore.useBip177Format) }}</div>
            </div>
            <div class="tx-row">
              <div class="tx-row-label">{{ $t('Total deducted') }}</div>
              <div class="tx-row-value">{{ formatAmount(totalDeductedSats, walletStore.useBip177Format) }}</div>
            </div>
          </template>
          <div
            v-else-if="transaction.fee && transaction.fee > 0"
            class="tx-row"
          >
            <div class="tx-row-label">{{ $t('Fee') }}</div>
            <div class="tx-row-value">{{ formatAmount(transaction.fee, walletStore.useBip177Format) }}</div>
          </div>

          <div v-if="getSettlementRateDisplay()" class="tx-row">
            <div class="tx-row-label">{{ $t('BTC price at settlement') }}</div>
            <div class="tx-row-value">{{ getSettlementRateDisplay() }}</div>
          </div>
        </div>
      </div>

      <!-- Sale breakdown (kiosk point-of-sale), only when the kiosk
           stamped one on this transaction. -->
      <div v-if="saleBreakdown" class="details-section">
        <div class="section-label">
          {{ $t('Sale') }}
        </div>
        <div class="tx-table">
          <div class="tx-row">
            <div class="tx-row-label">{{ $t('Subtotal') }}</div>
            <div class="tx-row-value">{{ formatAmount(saleBreakdown.baseSats, walletStore.useBip177Format) }}</div>
          </div>

          <div v-if="saleBreakdown.tipSats > 0" class="tx-row">
            <div class="tx-row-label">
              {{ saleBreakdown.roundUp && saleBreakdown.tipPercent == null ? $t('Round up') : $t('Tip') }}
            </div>
            <div class="tx-row-value">
              {{ formatAmount(saleBreakdown.tipSats, walletStore.useBip177Format) }}<template v-if="saleBreakdown.tipPercent != null"> ({{ saleBreakdown.tipPercent }}%)</template>
            </div>
          </div>

          <div v-if="saleBreakdown.discountSats > 0" class="tx-row">
            <div class="tx-row-label">{{ $t('Discount') }}</div>
            <div class="tx-row-value">-{{ formatAmount(saleBreakdown.discountSats, walletStore.useBip177Format) }}</div>
          </div>

          <div v-if="saleBreakdown.itemCount > 1" class="tx-row">
            <div class="tx-row-label">{{ $t('Items') }}</div>
            <div class="tx-row-value">{{ saleBreakdown.itemCount }}</div>
          </div>

          <div class="tx-row tx-row-total">
            <div class="tx-row-label">{{ $t('Total') }}</div>
            <div class="tx-row-value">{{ formatAmount(saleBreakdown.totalSats, walletStore.useBip177Format) }}</div>
          </div>
        </div>
      </div>

      <!-- Personal Note -->
      <div class="details-section">
        <div class="section-label">
          {{ $t('NOTE') }}
        </div>
        <div class="settings-card detail-card">
          <div class="note-content">
            <q-input
              :model-value="currentNote"
              @update:model-value="debounceSaveNote"
              :placeholder="$t('Add a personal note...')"
              type="textarea"
              autogrow
              borderless
              dense
              input-class="note-input"
              maxlength="500"
            />
          </div>
        </div>
      </div>

      <!-- LUD-09 message from the recipient, persisted from the send. -->
      <div v-if="currentSuccessAction" class="details-section">
        <div class="section-label">
          {{ $t('Message from recipient') }}
        </div>
        <div class="settings-card detail-card">
          <div class="success-action-detail">
            <!-- message: plain text -->
            <div v-if="currentSuccessAction.tag === 'message'" class="sa-detail-text">
              {{ currentSuccessAction.message }}
            </div>

            <!-- url: the recipient's note, then the destination itself on the
                 pill so the link target is readable before it is opened (new tab
                 on web, in-app view on native). -->
            <template v-else-if="currentSuccessAction.tag === 'url'">
              <div v-if="currentSuccessAction.description" class="sa-detail-text">
                {{ currentSuccessAction.description }}
              </div>
              <button
                type="button"
                class="sa-detail-open"
                @click="openSuccessActionUrl(currentSuccessAction.url)"
              >
                <span class="sa-detail-open-label">{{ successActionUrlLabel }}</span>
                <Icon icon="tabler:external-link" width="16" height="16" class="sa-detail-open-icon" />
              </button>
            </template>

            <!-- aes: decrypted secret (tap to copy) -->
            <template v-else-if="currentSuccessAction.tag === 'aes'">
              <div v-if="currentSuccessAction.description" class="sa-detail-text">
                {{ currentSuccessAction.description }}
              </div>
              <div v-if="currentSuccessAction.decryptError" class="sa-detail-error">
                {{ $t('Could not decrypt the message') }}
              </div>
              <div
                v-else
                class="sa-detail-row"
                @click="copySuccessSecret(currentSuccessAction.secret)"
              >
                <span class="sa-detail-secret">{{ currentSuccessAction.secret }}</span>
                <Icon icon="tabler:copy" width="16" height="16" />
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- LUD-21 delivery confirmation (fiat landed on the recipient's mobile
           money), shown once confirmed. -->
      <div v-if="deliveryStatus && deliveryStatus.delivered" class="details-section">
        <div class="section-label">
          {{ $t('Delivery') }}
        </div>
        <div class="settings-card detail-card">
          <div class="success-action-detail">
            <div class="delivery-detail">
              <Icon icon="tabler:circle-check-filled" width="18" height="18" class="delivery-detail-ok" />
              <div class="delivery-detail-text">
                <div class="delivery-detail-title">{{ $t('Delivered') }}</div>
                <div v-if="deliveryStatus.recipient || deliveryStatus.receipt" class="delivery-detail-sub">
                  <span v-if="deliveryStatus.recipient">{{ deliveryStatus.recipient }}</span>
                  <span v-if="deliveryStatus.recipient && deliveryStatus.receipt"> · </span>
                  <span v-if="deliveryStatus.receipt">{{ $t('Receipt') }} {{ deliveryStatus.receipt }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Zapper Section — who zapped, what they said, and the harvest
           action: a zap is a contact introducing themselves with money.
           Identity is real or absent (profile from relays, silhouette
           until then) — never fabricated.

           Verified zaps only. Without a valid signature on the zap
           request the sender is an unproven claim, so there is nobody to
           name, quote or save; the row keeps its nostr badge and this
           section simply does not exist. See utils/zaps. -->
      <div v-if="zapInfo?.verified" class="profile-section">
        <div class="profile-card">
          <div class="profile-avatar" @click="viewNostrProfile">
            <ContactAvatar
              class="zapper-avatar"
              :picture="nostrProfile?.picture || ''"
              :entry="{}"
            />
          </div>
          <div class="profile-info" @click="viewNostrProfile">
            <div class="profile-name">{{ zapperName }}</div>
            <div class="profile-meta">
              <Icon icon="tabler:bolt" class="zap-icon q-mr-xs" />
              {{ $t('Zap Transaction') }}
            </div>
            <div class="profile-about" v-if="zapInfo?.note">
              “{{ zapInfo.note }}”
            </div>
            <div class="profile-about" v-else-if="nostrProfile?.about">
              {{ nostrProfile.about }}
            </div>
          </div>
          <q-btn
            v-if="!zapperSaved"
            flat
            dense
            no-caps
            class="zapper-save-btn"
            :loading="savingZapper"
            @click.stop="saveZapperAsContact"
          >
            <Icon icon="tabler:user-plus" width="15" height="15" class="q-mr-xs" />
            {{ $t('Save') }}
          </q-btn>
          <Icon v-else icon="tabler:user-check" class="external-icon" />
        </div>
      </div>

      <!-- Contact Assignment Section -->
      <div class="details-section">
        <div class="section-label">
          {{ $t('CONTACT') }}
        </div>
        <div class="settings-card detail-card">
          <q-item v-if="!assignedContact" clickable v-ripple @click="openContactPicker">
            <q-item-section avatar>
              <Icon icon="tabler:user-plus" class="icon-muted" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="item-label">
                {{ $t('Assign Contact') }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <Icon icon="tabler:chevron-right" class="chevron-icon" />
            </q-item-section>
          </q-item>

          <q-item v-else>
            <q-item-section avatar>
              <ContactAvatar
                class="contact-avatar-small"
                :entry="assignedContact"
                :initial-length="2"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label class="item-label">
                {{ assignedContact.name }}
              </q-item-label>
              <q-item-label caption class="item-caption">
                {{ truncateAddress(assignedContact.address) }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat round dense @click="removeContact"
                     class="icon-muted">
                <Icon icon="tabler:x" width="20" height="20" />
                <q-tooltip>{{ $t('Remove Contact') }}</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </div>
      </div>

      <!-- Tags Section -->
      <div class="details-section">
        <div class="section-label">
          {{ $t('TAGS') }}
        </div>
        <div class="settings-card detail-card">
          <div class="tags-content">
            <div class="tag-selector">
              <button
                v-for="tag in availableTags"
                :key="tag"
                @click="toggleTag(tag)"
                class="tag-option"
                :class="{
                  selected: isTagSelected(tag),
                  disabled: currentTags.length >= 2 && !isTagSelected(tag)
                }"
                :disabled="currentTags.length >= 2 && !isTagSelected(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Developer Details -->
      <q-slide-transition>
        <div v-show="showDeveloperMode" class="developer-section">
          <div class="section-label">
            {{ $t('Technical details') }}
          </div>

          <div class="tx-table">
            <div
              v-if="transaction.id"
              class="tx-row tx-row-clickable"
              @click="copyToClipboard(transaction.id)"
            >
              <div class="tx-row-label">{{ $t('Transaction ID') }}</div>
              <div class="tx-row-value tx-row-value-copy">
                <span>{{ truncateMiddle(transaction.id) }}</span>
                <Icon icon="tabler:copy" width="14" height="14" class="copy-icon" />
              </div>
            </div>

            <div
              v-if="transaction.paymentHash || transaction.payment_hash"
              class="tx-row tx-row-clickable"
              @click="copyToClipboard(transaction.paymentHash || transaction.payment_hash)"
            >
              <div class="tx-row-label">{{ $t('Payment Hash') }}</div>
              <div class="tx-row-value tx-row-value-copy">
                <span>{{ truncateMiddle(transaction.paymentHash || transaction.payment_hash) }}</span>
                <Icon icon="tabler:copy" width="14" height="14" class="copy-icon" />
              </div>
            </div>

            <div
              v-if="transaction.preimage"
              class="tx-row tx-row-clickable"
              @click="copyToClipboard(transaction.preimage)"
            >
              <div class="tx-row-label">{{ $t('Preimage') }}</div>
              <div class="tx-row-value tx-row-value-copy">
                <span>{{ truncateMiddle(transaction.preimage) }}</span>
                <Icon icon="tabler:copy" width="14" height="14" class="copy-icon" />
              </div>
            </div>

            <div
              v-if="transaction.payment_request"
              class="tx-row tx-row-clickable"
              @click="copyToClipboard(transaction.payment_request)"
            >
              <div class="tx-row-label">{{ $t('Invoice') }}</div>
              <div class="tx-row-value tx-row-value-copy">
                <span>{{ truncateMiddle(transaction.payment_request) }}</span>
                <Icon icon="tabler:copy" width="14" height="14" class="copy-icon" />
              </div>
            </div>
          </div>

          <!-- Raw JSON -->
          <div class="raw-section">
            <div class="section-label">
              {{ $t('Raw JSON') }}
            </div>
            <div class="raw-content">
              <pre class="raw-text">{{
                  JSON.stringify(transaction, null, 2)
                }}</pre>
              <q-btn
                flat
                dense
                @click="copyToClipboard(JSON.stringify(transaction, null, 2))"
                class="copy-btn"
              >
                <Icon icon="tabler:copy" width="16" height="16" />
              </q-btn>
            </div>
          </div>
        </div>
      </q-slide-transition>
    </div>

    <!-- Error State -->
    <div v-else class="error-state">
      <Icon icon="tabler:alert-triangle" style="font-size: 4rem; color: red;" />
      <div class="error-title">
        {{ $t('Transaction Not Found') }}
      </div>
      <div class="error-subtitle">
        {{ $t('The requested transaction could not be found or loaded.') }}
      </div>
      <q-btn
        :label="$t('Go Back')"
        @click="$router.back()"
        class="go-back-btn"
      />
    </div>

    <!-- Contact Picker Modal -->
    <q-dialog v-model="showContactPicker">
      <q-card class="contact-picker-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="dialog-header">
          <div class="dialog-title">
            {{ $t('Select Contact') }}
          </div>
          <q-btn
            flat
            round
            dense
            v-close-popup
            class="close-btn"
            style="color: var(--text-muted)"
          >
            <Icon icon="tabler:x" width="20" height="20" />
          </q-btn>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input
            v-model="contactSearch"
            :placeholder="$t('Search contacts...')"
            dense
            borderless
            class="search-input"
            input-class="q-px-md"
          >
            <template v-slot:prepend>
              <Icon icon="tabler:search" class="q-ml-sm" style="color: var(--text-muted)" />
            </template>
          </q-input>
        </q-card-section>

        <q-scroll-area style="height: 280px" class="q-px-md">
          <q-list class="contact-list">
            <q-item
              v-for="contact in filteredContacts"
              :key="contact.id"
              clickable
              v-ripple
              @click="assignContact(contact)"
              class="contact-item"
            >
              <q-item-section avatar>
                <ContactAvatar
                  class="contact-avatar-picker"
                  :entry="contact"
                  :initial-length="2"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label class="item-label">
                  {{ contact.name }}
                </q-item-label>
                <q-item-label caption class="contact-address-caption item-caption">
                  {{ truncateAddress(contact.address) }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="chevron-icon" />
              </q-item-section>
            </q-item>

            <div v-if="filteredContacts.length === 0" class="empty-contacts-state">
              <Icon icon="tabler:users" width="48" height="48" style="color: var(--text-muted)" />
              <div class="empty-contacts-text">
                {{ $t('No contacts found') }}
              </div>
            </div>
          </q-list>
        </q-scroll-area>

        <q-card-actions class="dialog-actions q-px-md q-pb-md">
          <q-btn
            flat
            :label="$t('Cancel')"
            v-close-popup
            class="full-width"
            style="color: var(--text-secondary)"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import { fiatRatesService } from '../utils/fiatRates.js';
import { formatAmount, formatAmountWithPrefix } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';
import { useTransactionMetadataStore } from '../stores/transactionMetadata';
import { normalizeTx } from '../services/txNormalizer.js';
import { matchLnAddressService } from '../services/lnAddressServices';
import { shareContent } from '../utils/share';
import { copySensitive } from '../utils/sensitiveClipboard.js';
import { openInAppBrowser } from '../utils/inAppBrowser.js';
import { formatSuccessActionUrl } from '../utils/successAction.js';
import { pollVerify } from '../utils/lnurlVerify.js';
import { lnurlFetch } from '../utils/lnurlHttp.js';
import { Icon } from '@iconify/vue';
import ContactAvatar from '../components/AddressBook/ContactAvatar.vue';
import { zapInfoFromTx } from '../utils/zaps';
import { zapperProfile, zapperProfileEvent } from '../services/zapperProfiles';
import { NOSTRICH_HEAD_ICON } from '../utils/nostrIcon.js';
import { EARN_BRAND, earnRewardKind } from '../services/earnBrand';

// "Type" row text per metadata source (i18n message keys, resolved through
// $t at render time). Lookup map on purpose: later passes stamp more sources
// (e.g. 'nostr', 'phone') and only need a new entry here, no logic change.
const TX_SOURCE_TYPE_KEYS = {
  'internal-transfer': 'Internal transfer',
  'social-bucket': 'Profile payout',
  batch: 'Batch payment',
  kiosk: 'Kiosk sale',
  nostr: 'Nostr payment',
  phone: 'Phone payment',
};

export default {
  name: 'TransactionDetailsPage',
  components: { ContactAvatar, Icon },
  data() {
    return {
      loading: true,
      showDeveloperMode: false,
      transaction: null,
      nostrProfile: null,
      // NIP-57 zap info for this tx (utils/zaps), null for non-zaps.
      zapInfo: null,
      savingZapper: false,
      walletState: {},
      walletStore: null,
      addressBookStore: null,
      metadataStore: null,
      // LUD-21 delivery status for this tx (fiat-payout sends only): cached from
      // a prior confirmation, or re-checked once from the stored verify URL.
      deliveryStatus: null,
      showLoadingScreen: true,
      fiatRates: {},
      loadingFiatRates: true,
      // Contact picker
      showContactPicker: false,
      contactSearch: '',
      // Available tags
      availableTags: [
        'Groceries',
        'Business',
        'Personal',
        'Entertainment',
        'Bills',
        'Travel',
        'Food & Drink',
        'Shopping',
        'Other'
      ]
    }
  },
  async created() {
    this.walletStore = useWalletStore();
    this.addressBookStore = useAddressBookStore();
    this.metadataStore = useTransactionMetadataStore();

    // Initialize stores. The wallet store is included because this page can
    // be entered directly (a shared link, a reload, a cold app start on this
    // route) without ever passing through the wallet page that normally
    // hydrates it. initialize() is idempotent and returns immediately when
    // another caller already ran it, so the normal in-app navigation path
    // pays nothing for this.
    await this.walletStore.initialize();
    await this.addressBookStore.initialize();
    await this.metadataStore.initialize();

    this.initializeTransactionDetails();
    this.loadFiatRates();
  },

  beforeUnmount() {
    if (this._zapProfileTimer) clearInterval(this._zapProfileTimer);
  },

  watch: {
    'fiatRates': {
      handler() {
        this.$forceUpdate();
      },
      deep: true
    }
  },

  computed: {
    // Zapper display name — profile name when the relays answered, a
    // shortened npub until then. Honest, never invented.
    zapperName() {
      const name = (this.nostrProfile?.displayName || this.nostrProfile?.name || '').trim();
      if (name) return name;
      const npub = this.transaction?.senderNpub || '';
      return npub ? `${npub.slice(0, 9)}…${npub.slice(-4)}` : '';
    },

    // Already in the book? Then the harvest button yields to a quiet check.
    zapperSaved() {
      if (!this.zapInfo?.pubkey || !this.addressBookStore) return false;
      try {
        return !!this.addressBookStore.findContactByPubkey(this.zapInfo.pubkey);
      } catch {
        return false;
      }
    },

    /**
     * The wallet that owns this transaction: the ?wallet= route param
     * when present (see getRouteWallet, which fetchTransactionFromWallet
     * also consults to pick a provider), else the active wallet. Every
     * metadata read/write on this page goes through this single id, so a
     * `/transaction/:id` deep link always reads and writes the wallet
     * whose list actually shows the change (see transactionMetadata.js).
     */
    metadataWalletId() {
      const routeWallet = this.getRouteWallet();
      if (routeWallet?.id) return routeWallet.id;
      return this.walletStore?.activeWalletId || null;
    },

    assignedContact() {
      if (!this.transaction || !this.metadataStore) return null;
      // Same live resolution as the history list: explicit contactId,
      // then manual removal, then the durable recipient address.
      return this.metadataStore.getContactForTransaction(this.transaction.id, this.metadataWalletId);
    },

    /**
     * Who the hero avatar represents, when we know: the assigned contact,
     * else a resolved Nostr counterparty's profile picture (stamped at
     * send time), else, for the phone-number payout rail, the provider's
     * bundled logo. null falls back to the plain direction circle.
     * Shape: { entry, picture?, name? } | null. `entry.address` is also
     * carried alongside a resolved picture so ContactAvatar's own bundled
     * provider-logo lookup (which its explicit `picture` URL gate doesn't
     * cover) can still resolve the phone-rail logo.
     */
    heroAvatar() {
      if (!this.transaction) return null;
      if (this.assignedContact) return { entry: this.assignedContact };
      if (!this.metadataStore) return null;
      const address = this.getCounterpartyAddress();
      const name = this.assignedContact?.name || address || '';
      const avatar = this.metadataStore.getCounterpartyAvatarForTransaction(this.transaction.id, this.metadataWalletId);
      if (avatar?.picture) return { picture: avatar.picture, name, entry: { address } };
      // Zap: the zapper's relay profile picture (loaded by the zapper
      // section below) — the receipt shows the same face the list does.
      if (this.zapInfo && this.nostrProfile?.picture) {
        return { picture: this.nostrProfile.picture, name: this.zapperName, entry: {} };
      }
      if (this.metadataStore.getSourceForTransaction(this.transaction.id, this.metadataWalletId) === 'phone' && address) {
        const svc = matchLnAddressService(address);
        const logo = svc?.logo || svc?.flag || null;
        if (logo) return { picture: logo, name, entry: { address } };
      }
      return null;
    },

    /**
     * Movement-type badge for the hero — identical vocabulary to the
     * transaction list (received / sent / POS / batch / transfer / zap),
     * so the receipt and the row that opened it agree. The status chip
     * below the amount carries pending/expired; the badge only ever
     * names the movement.
     */
    heroBadge() {
      if (!this.transaction) return null;
      if (this.zapInfo || this.transaction.senderNpub) {
        return { icon: NOSTRICH_HEAD_ICON, cls: 'tx-badge-zap' };
      }
      try {
        const source = this.metadataStore?.getSourceForTransaction(this.transaction.id, this.metadataWalletId);
        if (source === 'kiosk') return { icon: 'tabler:building-store', cls: 'tx-badge-pos' };
        if (source === 'batch') return { icon: 'tabler:stack-2', cls: 'tx-badge-aux' };
        if (source === 'internal-transfer') return { icon: 'tabler:arrows-exchange', cls: 'tx-badge-aux' };
        if (source === 'social-bucket') return { icon: 'tabler:user-dollar', cls: 'tx-badge-aux' };
      } catch { /* metadata store not ready — direction still applies */ }
      return this.transaction.type === 'incoming'
        ? { icon: 'tabler:arrow-down-left', cls: 'tx-badge-in' }
        : { icon: 'tabler:arrow-up-right', cls: 'tx-badge-out' };
    },

    currentTags() {
      if (!this.transaction || !this.metadataStore) return [];
      return this.metadataStore.getTagsForTransaction(this.transaction.id, this.metadataWalletId);
    },

    currentNote() {
      if (!this.transaction || !this.metadataStore) return '';
      return this.metadataStore.getNoteForTransaction(this.transaction.id, this.metadataWalletId);
    },

    // LUD-09 message the recipient returned on this payment, persisted at send
    // time (already resolved — aes is decrypted before storage).
    //
    // Outgoing only: metadata is keyed by payment hash, and when both sides
    // of a payment live in this app (send from one wallet, receive on
    // another) the two transactions share that hash. Without the direction
    // guard the recipient wallet would show "Message from recipient" to the
    // recipient themselves.
    currentSuccessAction() {
      if (!this.transaction || !this.metadataStore) return null;
      if (this.transaction.type !== 'outgoing') return null;
      return this.metadataStore.getSuccessActionForTransaction(this.transaction.id, this.metadataWalletId);
    },

    /**
     * Destination of a LUD-09 `url` action, shortened for the pill so the link
     * target stays readable here as well as on the success sheet.
     */
    successActionUrlLabel() {
      return formatSuccessActionUrl(this.currentSuccessAction?.url);
    },

    /**
     * Branta merchant verification stamped on this outgoing send (see
     * runBrantaVerification in Wallet.vue) — the receipt-side counterpart
     * to the BrantaVerifiedBadge already shown on the confirm sheet
     * before sending. Outgoing only, same reasoning as
     * currentSuccessAction above (verification is only ever stamped by
     * the send path).
     */
    merchantVerification() {
      if (!this.transaction || !this.metadataStore) return null;
      if (this.transaction.type !== 'outgoing') return null;
      return this.metadataStore.getMerchantVerificationForTransaction(this.transaction.id, this.metadataWalletId);
    },

    filteredContacts() {
      if (!this.addressBookStore) return [];
      const entries = [...this.addressBookStore.entries].sort((a, b) => {
        return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
      });
      const query = this.contactSearch.toLowerCase();
      if (!query) return entries;

      return entries.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.address.toLowerCase().includes(query)
      );
    },

    /**
     * The "user-meaningful" amount in sats for this view's hero:
     *
     *   - Outgoing with a fee → recipient amount (gross − fee).
     *     Matches what the user typed when they hit Send, which is
     *     the mental model most Lightning wallets present on a
     *     transaction detail page.
     *   - Otherwise → gross transfer amount unchanged.
     *
     * `transaction.amount` itself stays as the gross movement so
     * downstream list views (TransactionHistory, balance-delta
     * math) keep matching real wallet movement. Only the detail
     * page's hero + fiat conversion read from this derived value.
     *
     * @returns {number} non-negative sats
     */
    displayAmountSats() {
      // The normalizer computed the recipient amount with the correct
      // per-provider fee semantics (Spark's amount includes the fee,
      // LNbits/NWC exclude it) — trust it when present.
      const recipient = Number(this.transaction?.recipientSats);
      if (Number.isFinite(recipient)) return Math.abs(recipient);
      const gross = Math.abs(Number(this.transaction?.amount) || 0);
      const fee = Number(this.transaction?.fee) || 0;
      if (this.transaction?.type === 'outgoing' && fee > 0) {
        // Defensive: clamp to 0 if a malformed record reports a fee
        // larger than the gross — never render a negative hero.
        return Math.max(0, gross - fee);
      }
      return gross;
    },

    /** True when the fee + total breakdown rows should render. */
    showFeeBreakdown() {
      const fee = Number(this.transaction?.feeSats ?? this.transaction?.fee) || 0;
      return this.transaction?.type === 'outgoing' && fee > 0;
    },

    /** Total deducted for the "Total" row in the breakdown. */
    totalDeductedSats() {
      const total = Number(this.transaction?.totalSats);
      if (Number.isFinite(total)) return Math.abs(total);
      return Math.abs(Number(this.transaction?.amount) || 0);
    },

    /**
     * Translated "Type" row text when an auxiliary payment path stamped a
     * metadata source on this tx; '' hides the row (unknown enums included,
     * so a newer stamp never renders a raw identifier).
     */
    txTypeRowText() {
      // A reward has no metadata source stamped on it (it is an incoming
      // payment the app never sent), so name it from its own branding.
      if (this.earnRewardLabel) return this.earnRewardLabel;
      if (!this.transaction?.id || !this.metadataStore) return '';
      const source = this.metadataStore.getSourceForTransaction(this.transaction.id, this.metadataWalletId);
      const key = TX_SOURCE_TYPE_KEYS[source];
      return key ? this.$t(key) : '';
    },

    /** BuhoGO mark shown on Learn & Earn reward transactions. */
    earnBrandLogo() {
      return EARN_BRAND.logo;
    },

    /**
     * Localised label for a Learn & Earn reward, '' when this tx is not one.
     * The invoice memo stays untranslated so it keeps matching after a
     * language change; what the user reads is resolved here.
     */
    earnRewardLabel() {
      const kind = earnRewardKind(this.transaction);
      if (!kind) return '';
      return kind === 'bonus'
        ? this.$t('Learn & Earn bonus')
        : this.$t('Learn & Earn reward');
    },

    isEarnReward() {
      return this.earnRewardLabel !== '';
    },

    /**
     * The curated point-of-sale breakdown a kiosk sale stamped on this
     * transaction at invoice-creation time (subtotal, tip/round-up
     * uplift, discount reserved for a future POS control, item count,
     * total), scoped to `walletId`. null for every transaction the kiosk
     * didn't create — the Sale section only renders when this is
     * non-null.
     */
    saleBreakdown() {
      if (!this.transaction?.id || !this.metadataStore) return null;
      return this.metadataStore.getSaleBreakdownForTransaction(this.transaction.id, this.metadataWalletId);
    }
  },

  methods: {
    // Notes
    debounceSaveNote(value) {
      clearTimeout(this._noteTimer);
      this._noteTimer = setTimeout(() => {
        this.metadataStore.setNoteForTransaction(this.transaction.id, this.metadataWalletId, value);
      }, 500);
    },

    // Contact and Tag methods
    openContactPicker() {
      console.log('Opening contact picker...');
      console.log('Address book entries:', this.addressBookStore?.entries?.length || 0);
      this.showContactPicker = true;
      console.log('showContactPicker set to:', this.showContactPicker);
    },

    async assignContact(contact) {
      try {
        await this.metadataStore.setContactForTransaction(this.transaction.id, this.metadataWalletId, contact.id);
        this.showContactPicker = false;
        this.contactSearch = '';

        // Update lastUsedAt in address book
        await this.addressBookStore.updateEntry(contact.id, { lastUsedAt: Date.now() });

        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact assigned'),
          
          timeout: 2000
        });
      } catch (error) {
        console.error('Error assigning contact:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to assign contact'),
          
        });
      }
    },

    async removeContact() {
      try {
        // Use the dedicated clear so live address resolution won't
        // immediately re-attach the same contact after removal.
        await this.metadataStore.clearContactForTransaction(this.transaction.id, this.metadataWalletId);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact removed'),
          
          timeout: 2000
        });
      } catch (error) {
        console.error('Error removing contact:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to remove contact'),
          
        });
      }
    },

    isTagSelected(tag) {
      return this.currentTags.includes(tag);
    },

    async toggleTag(tag) {
      try {
        const currentTags = this.currentTags;

        // Check if tag is already selected
        if (currentTags.includes(tag)) {
          // Remove tag
          const newTags = currentTags.filter(t => t !== tag);
          await this.metadataStore.setTagsForTransaction(this.transaction.id, this.metadataWalletId, newTags);
        } else {
          if (currentTags.length >= 2) return;

          // Add tag
          const newTags = [...currentTags, tag];
          await this.metadataStore.setTagsForTransaction(this.transaction.id, this.metadataWalletId, newTags);
        }
      } catch (error) {
        console.error('Error toggling tag:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to update tags'),
          
        });
      }
    },

    truncateAddress(address) {
      if (!address || address.length <= 20) return address;
      return `${address.substring(0, 10)}...${address.substring(address.length - 6)}`;
    },

    /**
     * Middle-truncates long technical values (hashes, invoices) for the
     * developer-mode rows: keeps a `head`-char prefix and `tail`-char
     * suffix, dropping the middle. Returns the value unchanged when it's
     * already short enough that truncating wouldn't save space.
     *
     * @param {string} value
     * @param {number} head
     * @param {number} tail
     */
    truncateMiddle(value, head = 10, tail = 6) {
      if (!value || typeof value !== 'string') return value;
      if (value.length <= head + tail) return value;
      return `${value.substring(0, head)}...${value.substring(value.length - tail)}`;
    },

    async initializeTransactionDetails() {
      try {
        await this.loadTransactionDetails();
        this.loadDeveloperModePreference();
        this.showLoadingScreen = false;
        // Runs only after the transaction is loaded (cache hit OR async fetch),
        // so the stored verify URL / cached delivery status is always available.
        this.resolveDeliveryStatus();
      } catch (error) {
        console.error('Error initializing transaction details:', error);
        this.showLoadingScreen = false;
      }
    },

    async loadTransactionDetails() {
      this.loading = true;
      try {
        const txId = this.$route.params.id;

        // Load wallet state
        const savedState = localStorage.getItem('buhoGO_wallet_state');
        if (savedState) {
          this.walletState = JSON.parse(savedState);
        }

        // Try to find transaction in local storage first
        const cachedTransactions = localStorage.getItem('buhoGO_cached_transactions');
        if (cachedTransactions) {
          const transactions = JSON.parse(cachedTransactions);
          this.transaction = transactions.find(tx => tx.id === txId);
        }

        // If not found locally, fetch from wallet
        if (!this.transaction) {
          await this.fetchTransactionFromWallet(txId);
        }

        // Zap recognition + zapper profile. The list may have stamped
        // senderNpub already; a deep link lands here cold, so re-derive
        // from the description either way (NIP-57 kind-9734 parse, with
        // the legacy bare-npub fallback inside zapInfoFromTx).
        if (this.transaction) {
          this.zapInfo = zapInfoFromTx(this.transaction);
          if (this.zapInfo?.npub && !this.transaction.senderNpub) {
            this.transaction.senderNpub = this.zapInfo.npub;
          }
          if (this.zapInfo) this.loadZapperProfile();
        }

      } catch (error) {
        console.error('Error loading transaction details:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t load details'),
          
        });
      } finally {
        this.loading = false;
      }
    },

    /**
     * The wallet the tx list said this tx belongs to (?wallet= query
     * param), resolved against the persisted wallet list. null when the
     * param is absent or unknown — the caller then falls back to the
     * active wallet, exactly as before the param existed.
     */
    getRouteWallet() {
      try {
        const walletId = this.$route.query.wallet;
        if (!walletId) return null;
        return this.walletState.connectedWallets?.find(w => w.id === walletId) || null;
      } catch (error) {
        return null;
      }
    },

    async fetchTransactionFromWallet(txId) {
      try {
        // Prefer the wallet named in the route: /transaction/:id alone is
        // ambiguous across wallets (both sides of an internal payment can
        // share an id), so the tx list passes the owning wallet along.
        // Absent or unknown param -> the active wallet, as before.
        const routeWallet = this.getRouteWallet();
        const routeType = (routeWallet?.type || '').toLowerCase();

        if (routeWallet && routeType === 'spark') {
          await this.fetchSparkTransaction(txId, routeWallet.id);
        } else if (routeWallet && routeType === 'lnbits') {
          await this.fetchLNBitsTransaction(txId, routeWallet.id);
        } else if (routeWallet && routeType === 'arkade') {
          await this.fetchArkadeTransaction(txId, routeWallet.id);
        } else if (routeWallet && routeType === 'nwc') {
          await this.fetchNWCTransaction(txId, routeWallet);
        } else if (this.walletStore.isActiveWalletSpark) {
          await this.fetchSparkTransaction(txId);
        } else if (this.walletStore.isActiveWalletLNBits) {
          await this.fetchLNBitsTransaction(txId);
        } else if (this.walletStore.isActiveWalletArkade) {
          await this.fetchArkadeTransaction(txId);
        } else {
          await this.fetchNWCTransaction(txId);
        }

      } catch (error) {
        console.error('Error fetching transaction from wallet:', error);
      }
    },

    async fetchSparkTransaction(txId, walletId = null) {
      // Ensure the Spark wallet is connected (auto-connects if a session PIN
      // is available). Spark's Business and Personal wallets are separate
      // accounts with separate providers, so a deep link that names one must
      // target it explicitly: without the id we would read whichever Spark
      // wallet is active, or throw outright when the active wallet is not
      // Spark at all.
      const provider = await this.walletStore.ensureSparkConnected(walletId);

      const transactions = await provider.getTransactions({ limit: 100, offset: 0 });
      const found = transactions.find(tx => tx.id === txId);

      if (found) {
        this.transaction = this.normalizeForDetails(found, 'spark');
        console.log('Transaction loaded with description:', this.transaction.description);
      }
    },

    /**
     * One canonical mapping for every provider's raw tx (see
     * services/txNormalizer.js), merged with the stored
     * price-at-settlement snapshot when the provider has none.
     */
    normalizeForDetails(rawTx, walletType) {
      const stored = this.metadataStore?.getFiatAtSettlementForTransaction(rawTx?.id, this.metadataWalletId) || null;
      return normalizeTx(rawTx, { walletType, fiatAtSettlement: stored });
    },

    async fetchArkadeTransaction(txId, walletId = null) {
      // Arkade uses a provider like Spark; getTransactions() already returns
      // direction as 'incoming'/'outgoing' and unix-seconds timestamps.
      const provider = await this.walletStore.ensureArkadeConnected(walletId || this.walletStore.activeWalletId);

      const transactions = await provider.getTransactions();
      const found = transactions.find(tx => tx.id === txId);

      if (found) {
        this.transaction = this.normalizeForDetails(found, 'arkade');
      }
    },

    async fetchNWCTransaction(txId, wallet = null) {
      // The route-named wallet's connection when provided, else the active
      // one — each NWC wallet has its own connection string.
      const targetWallet = wallet || this.walletState.connectedWallets?.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (!targetWallet?.nwcString) {
        throw new Error('No active NWC wallet found');
      }

      const nwc = new NostrWebLNProvider({
        nostrWalletConnectUrl: targetWallet.nwcString,
      });

      await nwc.enable();

      const transactionsResponse = await nwc.listTransactions({ limit: 100 });

      if (transactionsResponse && transactionsResponse.transactions) {
        const found = transactionsResponse.transactions.find(tx =>
          tx.id === txId || tx.payment_hash === txId
        );

        if (found) {
          this.transaction = this.normalizeForDetails({
            ...found,
            id: found.id || found.payment_hash || txId,
            fee: found.fee || found.fees_paid || 0,
            payment_request: found.payment_request || found.invoice || null
          }, 'nwc');
          console.log('NWC Transaction loaded with description:', this.transaction.description);
        }
      }
    },

    async fetchLNBitsTransaction(txId, walletId = null) {
      const targetId = walletId || this.walletStore.activeWallet?.id;
      if (!targetId) {
        throw new Error('No active LNbits wallet found');
      }

      let provider = this.walletStore.providers[targetId];
      if (!provider) {
        await this.walletStore.connectLNBitsWallet(targetId);
        provider = this.walletStore.providers[targetId];
      }

      if (!provider) {
        throw new Error('Could not connect to LNbits wallet');
      }

      const transactions = await provider.getTransactions({ limit: 100, offset: 0 });
      const found = transactions.find(tx => tx.id === txId);

      if (found) {
        this.transaction = this.normalizeForDetails(found, 'lnbits');
      }
    },

    /**
     * Real zapper profile via the shared reactive cache (relays through
     * zapperProfiles) — polled briefly because the cache fills async.
     * Nothing is fabricated: no profile means the section renders the
     * shortened npub and the silhouette, same honesty as the tx list.
     */
    loadZapperProfile() {
      const read = () => {
        const profile = zapperProfile(this.zapInfo);
        if (profile) this.nostrProfile = profile;
        return !!profile;
      };
      if (read()) return;
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (read() || attempts >= 10) clearInterval(timer);
      }, 800);
      this._zapProfileTimer = timer;
    },

    /**
     * Harvest a zapper into the address book — the zap already told us
     * who they are (pubkey) and the profile fetch supplies lud16 +
     * name/avatar. Uses the same store path as Add contact → Search,
     * so dedupe and Nostr metadata handling stay identical.
     */
    async saveZapperAsContact() {
      // `verified` is what earns a zapper a name; saving one as a contact
      // is that attribution made permanent, so it needs the same proof.
      // The button is already hidden without it — this is the backstop.
      if (!this.zapInfo?.verified) return;
      if (!this.zapInfo?.pubkey || !this.zapInfo?.npub) return;
      this.savingZapper = true;
      try {
        // The address book verifies the raw kind-0 event itself
        // (kind / author / signature) — hand it the original, cached
        // from the list's fetch or freshly pulled here.
        const event = await zapperProfileEvent(this.zapInfo);
        if (!event) {
          this.$q.notify({
            type: 'info',
            message: this.$t("This zapper hasn't published a profile yet"),
          });
          return;
        }
        await this.addressBookStore.addNostrContact({
          pubkey: this.zapInfo.pubkey,
          npub: this.zapInfo.npub,
          event,
          allowWithoutLightningAddress: true,
        });
        this.$q.notify({ type: 'positive', message: this.$t('Contact added') });
      } catch (error) {
        // Most common: already saved — surface the store's message as-is.
        this.$q.notify({ type: 'info', message: error?.message || this.$t("Couldn't save contact") });
      } finally {
        this.savingZapper = false;
      }
    },

    loadDeveloperModePreference() {
      // Always start closed — devs can toggle per session
      this.showDeveloperMode = false;
    },

    toggleDeveloperMode() {
      this.showDeveloperMode = !this.showDeveloperMode;
    },

    getTransactionTypeLabel() {
      if (this.isBitcoinTransaction()) {
        return this.transaction.type === 'incoming' ? this.$t('Bitcoin Deposit') : this.$t('Bitcoin Withdrawal');
      }
      if (this.transaction.senderNpub) return this.$t('Zap Received');
      return this.transaction.type === 'incoming' ? this.$t('Payment Received') : this.$t('Payment Sent');
    },

    getTransactionIconClass() {
      if (this.isBitcoinTransaction()) return 'tx-status-bitcoin';
      if (this.transaction.senderNpub) return 'tx-status-zap';
      return this.transaction.type === 'incoming' ? 'tx-status-received' : 'tx-status-sent';
    },


    /**
     * Check if transaction is a Bitcoin L1 deposit/withdrawal
     */
    isBitcoinTransaction() {
      if (!this.transaction) return false;
      // Check rawType or type from Spark SDK
      const rawType = (this.transaction.rawType || '').toLowerCase();
      if (rawType.includes('l1') || rawType.includes('deposit') || rawType.includes('withdrawal') ||
          rawType.includes('coop_exit') || rawType.includes('static_deposit')) {
        return true;
      }
      // Check description/memo
      const desc = (this.transaction.description || this.transaction.memo || '').toLowerCase();
      if (desc.includes('bitcoin deposit') || desc.includes('bitcoin withdrawal') ||
          desc.includes('l1 deposit') || desc.includes('l1 withdrawal')) {
        return true;
      }
      return false;
    },

    getAccentClass() {
      if (this.transaction.senderNpub) return 'accent-zap';
      return this.transaction.type === 'incoming' ? 'accent-positive' : 'accent-negative';
    },

    getTransactionStatus() {
      if (this.transaction.status === 'expired') return this.$t('Expired');
      if (this.transaction.settled) return this.$t('Completed');
      if (this.transaction.pending || this.transaction.status === 'pending') return this.$t('Pending');
      return this.$t('Completed');
    },

    getStatusIcon() {
      if (this.transaction.status === 'expired') return 'tabler:clock-x';
      if (this.transaction.settled) return 'tabler:circle-check';
      if (this.transaction.pending || this.transaction.status === 'pending') return 'tabler:clock';
      return 'tabler:circle-check';
    },

    getStatusClass() {
      if (this.transaction.status === 'expired') return 'status-expired';
      if (this.transaction.settled) return 'status-completed';
      if (this.transaction.pending || this.transaction.status === 'pending') return 'status-pending';
      return 'status-completed';
    },

    getAmountClass() {
      return this.transaction.type === 'incoming' ? 'amount-positive' : 'amount-negative';
    },

    getTransactionDescription() {
      if (this.transaction.description && this.transaction.description.trim() !== '') {
        return this.transaction.description;
      }
      if (this.transaction.memo && this.transaction.memo.trim() !== '') {
        return this.transaction.memo;
      }
      return null;
    },

    getExtraComment() {
      // The normalizer already lifted the LUD-12 comment onto the
      // canonical shape when the provider had one.
      if (this.transaction?.comment) return this.transaction.comment;
      if (!this.transaction?.extra) return null;
      const extra = this.transaction.extra;
      // LNbits stores LNURL comments in extra.comment
      if (typeof extra === 'object' && extra.comment) return extra.comment;
      if (typeof extra === 'string') {
        try {
          const parsed = JSON.parse(extra);
          return parsed.comment || null;
        } catch { return null; }
      }
      return null;
    },

    /**
     * The counterparty line: for sends, the recipient address stamped at
     * send time; for receives, the Lightning address that was paid when
     * the backend reports one. Null hides the row.
     */
    getCounterpartyAddress() {
      if (!this.transaction) return null;
      if (this.transaction.type === 'outgoing' && this.transaction.id && this.metadataStore) {
        const meta = this.metadataStore.getMetadataForTransaction(this.transaction.id, this.metadataWalletId);
        if (meta?.recipientAddress) return meta.recipientAddress;
      }
      if (this.transaction.type === 'incoming' && this.transaction.lnaddress) {
        return this.transaction.lnaddress;
      }
      return null;
    },

    /** Currency-symbol formatting shared by the fiat rows. */
    formatFiatValue(amount, currency) {
      const symbols = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', CHF: 'CHF', AUD: 'A$', JPY: '¥' };
      const symbol = symbols[currency] || (currency ? `${currency} ` : '');
      return `${symbol}${Number(amount).toFixed(2)}`;
    },

    /**
     * The BTC price row: the rate this payment actually settled at.
     * Provided directly by LNbits; captured live for other providers.
     */
    getSettlementRateDisplay() {
      const snap = this.transaction?.fiatAtSettlement;
      if (!snap || !Number.isFinite(Number(snap.rate))) return null;
      const locale = this.$i18n?.locale || 'en-US';
      const formatted = Number(snap.rate).toLocaleString(locale, { maximumFractionDigits: 0 });
      const symbols = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', CHF: 'CHF', AUD: 'A$', JPY: '¥' };
      const symbol = symbols[snap.currency] || snap.currency || '';
      return `${symbol}${formatted}`;
    },

    /**
     * Template-facing wrapper around the imported `formatAmount`
     * helper from `utils/amountFormatting.js`. Module-level imports
     * aren't auto-exposed on an Options API component instance, so
     * the template can't reach the helper directly. Wrapping it as
     * a method (same name, same signature) lets every existing
     * call site in the template — `formatAmount(transaction.fee,
     * walletStore.useBip177Format)` etc. — resolve correctly.
     *
     * @param {number} sats
     * @param {boolean} useBip177
     */
    formatAmount(sats, useBip177) {
      return formatAmount(sats, useBip177);
    },

    getFormattedAmount() {
      const prefix = this.transaction.type === 'incoming' ? '+' : '-';
      return formatAmountWithPrefix(this.displayAmountSats, this.walletStore.useBip177Format, prefix);
    },

    async loadFiatRates() {
      try {
        this.loadingFiatRates = true;
        await fiatRatesService.ensureRatesLoaded();
        this.fiatRates = await fiatRatesService.getRates();
      } catch (error) {
        console.error('Error loading fiat rates:', error);
      } finally {
        this.loadingFiatRates = false;
      }
    },

    getFiatAmount() {
      if (this.loadingFiatRates || !this.transaction) {
        return '...';
      }

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        // Fiat tracks the hero amount so the two never disagree.
        // For an outgoing payment with a fee, both reflect what the
        // recipient received (not the gross deducted).
        const fiatValue = fiatRatesService.convertSatsToFiatSync(this.displayAmountSats, currency);

        // Handle unavailable rates
        if (fiatValue === null) {
          return '--';
        }

        const symbols = {
          USD: '$',
          EUR: '€',
          GBP: '£',
          CAD: 'C$',
          CHF: 'CHF',
          AUD: 'A$',
          JPY: '¥'
        };

        const symbol = symbols[currency] || currency;
        return symbol + fiatValue.toFixed(2);
      } catch (error) {
        console.error('Error converting to fiat:', error);
        return '--';
      }
    },

    formatDateTime(timestamp) {
      const date = new Date(timestamp * 1000);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const txDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

      if (txDate.getTime() === today.getTime()) {
        return `${this.$t('Today at')} ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}`;
      } else if (txDate.getTime() === yesterday.getTime()) {
        return `${this.$t('Yesterday at')} ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}`;
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }) + ` ${this.$t('at')} ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })}`;
      }
    },

    formatTimestamp(timestamp) {
      return new Date(timestamp * 1000).toISOString();
    },

    /**
     * Precise locale datetime (down to the second) for the split
     * Created/Settled rows, so two settlements a few seconds apart
     * read as distinct instead of both rounding to the same minute.
     */
    formatPreciseDateTime(ts) {
      return new Date(ts * 1000).toLocaleString(this.$i18n?.locale || 'en-US', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    },

    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Copied'),
          
        });
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
        });
      }
    },

    // Open a LUD-09 `url` successAction (a receipt, a group invite, a download).
    // Scheme-validated upstream to http(s), and the destination is printed on the
    // button itself, so nothing opens the user hasn't read.
    // New tab on web, in-app view (Custom Tab / SFSafariViewController) on native.
    openSuccessActionUrl(url) {
      if (url) openInAppBrowser(url);
    },

    // Open Branta's verification page for this merchant. Mirrors
    // BrantaVerifiedBadge.open() — a record with no verifyUrl (name/logo
    // only) makes the row a static seal, not a link.
    openMerchantVerifyUrl() {
      if (this.merchantVerification?.verifyUrl) openInAppBrowser(this.merchantVerification.verifyUrl);
    },

    // LUD-21: show the fiat-delivery confirmation for this tx. Prefer a cached
    // status; otherwise do a single re-check of the stored verify URL (already
    // validated same-domain at send time). Best-effort — never blocks the view.
    async resolveDeliveryStatus() {
      if (!this.transaction || !this.metadataStore) return;
      const cached = this.metadataStore.getDeliveryStatusForTransaction(this.transaction.id, this.metadataWalletId);
      if (cached) { this.deliveryStatus = cached; return; }
      const verifyUrl = this.metadataStore.getVerifyUrlForTransaction(this.transaction.id, this.metadataWalletId);
      if (!verifyUrl) return;
      const status = await pollVerify(verifyUrl, null, { timeoutMs: 0, intervalMs: 0, fetchImpl: lnurlFetch });
      if (!status) return;
      this.deliveryStatus = status;
      // Cache once delivery is confirmed so later views are instant and offline.
      if (status.delivered) {
        try {
          await this.metadataStore.setDeliveryStatusForTransaction(this.transaction.id, this.metadataWalletId, status);
        } catch { /* best-effort cache */ }
      }
    },

    // The decrypted `aes` secret is proof-of-payment material, so copy it via
    // the sensitive-clipboard helper (auto-wipe), matching the success screen.
    async copySuccessSecret(secret) {
      if (!secret) return;
      try {
        await copySensitive(secret);
        this.$q.notify({ type: 'positive', message: this.$t('Copied') });
      } catch (error) {
        console.error('Failed to copy secret:', error);
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't copy") });
      }
    },

    viewNostrProfile() {
      if (this.transaction.senderNpub) {
        const nostrUrl = `https://snort.social/p/${this.transaction.senderNpub}`;
        window.open(nostrUrl, '_blank');
      }
    },

    async shareTransaction() {
      if (!this.transaction) return;

      const direction = this.transaction.type === 'incoming' ? 'Received' : 'Sent';
      const amount = this.getFormattedAmount();
      const fiat = this.getFiatAmount();
      const date = this.formatDateTime(this.transaction.settled_at);
      const desc = this.getTransactionDescription();

      let text = `${direction} ${amount}`;
      if (fiat && fiat !== '--' && fiat !== '...') text += ` (${fiat})`;
      text += `\n${date}`;
      if (desc) text += `\n${desc}`;
      text += '\n\nvia BuhoGO\nhttps://home.mybuho.de/buhogo';

      const result = await shareContent({ title: `${direction} ${amount}`, text });
      if (result.reason === 'unsupported' || result.reason === 'error') {
        await this.copyToClipboard(text);
      }
    }
  }
}
</script>

<style scoped>
/* ===== Base Page ===== */
.transaction-details-page {
  background: var(--bg-secondary);
  min-height: 100vh;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  /* The header owns the top safe-area inset (see .page-header), so the
     global .q-page top padding is cancelled here. */
  padding-top: 0;
}

/* ===== Header ===== */
/* The header owns the top inset: its background fills the area under the
   status bar and the title sits just beneath it. The sticky offset must
   stay 0: overflow-x:hidden on this page (and on html/body) turns those
   elements into scroll containers, so a non-zero `top` doesn't pin the
   header to the viewport — it displaces it downward over the hero card
   even before any scrolling (the Android "gap above the title" bug). */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(1rem + var(--safe-top, 0px)) 1rem 1rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
  position: sticky;
  top: 0;
  z-index: 100;
}

.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  transition: background-color 0.15s ease;
}

.back-btn:hover {
  background: var(--bg-input);
}

.header-title {
  color: var(--text-primary);
  font-size: 1.25rem;
  font-weight: 600;
  flex: 1;
  text-align: center;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.dev-toggle {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.dev-toggle:hover {
  background: var(--bg-input);
}

.dev-toggle.dev-active {
  background: rgba(21, 222, 114, 0.1);
}

.dev-icon-active {
  color: #15DE72;
}

.dev-icon-muted {
  color: var(--text-secondary);
}

.dev-active-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #15DE72;
}

/* ===== Note Field ===== */
.note-content {
  padding: 4px 12px;
}

.note-input {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
}

/* ===== LUD-09 message from recipient ===== */
.success-action-detail {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sa-detail-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.5;
  word-break: break-word;
}

.sa-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--text-muted);
  cursor: pointer;
}

.sa-detail-secret {
  font-family: 'SF Mono', ui-monospace, 'Roboto Mono', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
}

/* url action: a single elegant "open" row (new tab on web, in-app on native). */
.sa-detail-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  transition: filter 0.15s ease, transform 0.08s ease;
}

.sa-detail-open:active { transform: scale(0.99); }

.sa-detail-open-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sa-detail-open-icon {
  flex-shrink: 0;
  opacity: 0.65;
}

/* LUD-21 delivery confirmation row. */
.delivery-detail {
  display: flex;
  align-items: center;
  gap: 10px;
}
.delivery-detail-ok {
  color: #34C759;
  flex-shrink: 0;
}
.delivery-detail-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.delivery-detail-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}
.delivery-detail-sub {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-word;
}

.sa-detail-error {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: #FF6B6B;
}

/* ===== Loading States ===== */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  background: var(--bg-primary);
}

.loading-text {
  margin-top: 1rem;
  color: var(--text-secondary);
  font-size: 1rem;
}

/* ===== Transaction Content ===== */
.transaction-content {
  min-height: calc(100vh - 80px);
  /* Bottom-most content wrapper for the loaded state - clears the Android
     gesture/nav bar the same way the rest of the app does. */
  padding-bottom: max(1rem, var(--safe-bottom, 0px));
}

/* ===== Transaction Hero Card ===== */
.transaction-hero {
  padding: 1rem;
}

.hero-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  overflow: visible;
}

/* Centered column: direction icon, signed amount, fiat value, status pill. */
.hero-content {
  padding: 28px 20px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* direction-circle is defined globally in app.css; enlarged for the hero */
.hero-direction-circle {
  width: 56px;
  height: 56px;
  min-width: 56px;
  font-size: 26px;
  margin-bottom: 10px;
}

/* Same footprint as .hero-direction-circle, for the ContactAvatar variant
   shown when the hero knows who the payment was with. */
.hero-avatar-wrap {
  position: relative;
  display: inline-flex;
  margin-bottom: 10px;
}

.hero-avatar-wrap .hero-avatar {
  margin-bottom: 0;
}

/* Movement-type badge on the hero — same vocabulary and colors as the
   transaction list, so the receipt and the row agree at a glance. */
.hero-type-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 0 0 2.5px var(--bg-card);
}

.tx-badge-in { background: #10B981; }
.tx-badge-out { background: #EF4444; }
.tx-badge-pos { background: #3B82F6; }
.tx-badge-aux { background: #64748B; }
.tx-badge-zap { background: #662482; }

/* Nostr ostrich head, sized up for the same reason as in the history
   list: it is filled art, not a stroked glyph, so it needs roughly
   three quarters of the disc to stay readable. This disc is 20px. */
.tx-badge-zap :deep(svg) {
  width: 15px;
  height: 15px;
}

.hero-avatar {
  width: 56px;
  height: 56px;
  min-width: 56px;
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  font-family: 'Manrope', sans-serif;
  margin-bottom: 10px;
}

/* Learn & Earn reward hero. The BuhoGO mark is a full-bleed square tile
   carrying its own dark backdrop, so it fills the circle rather than sitting
   on a tinted one. */
.hero-avatar-earn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
}

.hero-earn-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

/* In the hero, an outgoing payment is a normal event, not a warning — the
   global red direction wash reads as an error at this size. Scoped override
   only: incoming keeps its soft green, the global classes stay untouched. */
.hero-direction-circle.direction-circle-red {
  background: var(--bg-input);
  color: var(--text-secondary);
}

.direction-circle-bitcoin {
  background: rgba(247, 147, 26, 0.15);
  color: #F7931A;
}

.hero-amount {
  font-family: 'Manrope', sans-serif;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.25;
}

.hero-amount.amount-positive {
  color: #15DE72;
}

.hero-amount.amount-negative {
  color: var(--text-primary);
}

.hero-fiat {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 2px;
}

.hero-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 999px;
  margin-top: 10px;
}

.hero-status-chip.status-completed {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
}

.hero-status-chip.status-pending {
  background: rgba(245, 166, 35, 0.14);
  color: #F5A623;
}

/* Expired invoice: muted text on a soft red-tinted wash — clearly "dead",
   without the alarm-red of a failure. */
.hero-status-chip.status-expired {
  background: rgba(255, 68, 68, 0.10);
  color: var(--text-muted);
}

/* ===== Profile Section ===== */
.profile-section {
  padding: 1rem;
  cursor: pointer;
}

.zapper-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
}

.zapper-save-btn {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-input);
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  transition: background-color 0.2s;
}

.profile-card:hover {
  background: var(--bg-input);
}

.profile-info {
  flex: 1;
}

.profile-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.profile-meta {
  display: flex;
  align-items: center;
  color: #15DE72;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.zap-icon {
  color: #78D53C;
}

.profile-about {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.external-icon {
  color: var(--text-secondary);
}

/* ===== Details Section ===== */
.details-section {
  padding: 0 1rem;
  margin-bottom: 1rem;
}

.section-label {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin: 1.5rem 0 0.5rem 0.25rem;
  color: var(--text-muted);
}

.section-label:first-child {
  margin-top: 0.5rem;
}

/* ===== Cards ===== */
.settings-card {
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 0;
}

.detail-card {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
}

.settings-card :deep(.q-item) {
  padding: 14px 16px;
  min-height: 48px;
}

/* ===== Item labels / captions (unified) ===== */
.item-label {
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
}

.item-caption {
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  margin-top: 2px;
}

.chevron-icon {
  color: var(--text-muted);
  font-size: 18px;
}

.icon-muted {
  color: var(--text-muted);
}

.contact-avatar-small {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: 600;
  color: white;
  font-family: 'Manrope', sans-serif;
}

/* ===== Transaction Table (key-value card) ===== */
.tx-table {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tx-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-card);
}

.tx-row:last-child {
  border-bottom: none;
}

.tx-row-label {
  flex-shrink: 0;
  max-width: 45%;
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
}

.tx-row-value {
  min-width: 0;
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  text-align: right;
  word-break: break-word;
}

.tx-row-clickable {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.tx-row-clickable:hover,
.tx-row-clickable:active {
  background: var(--bg-input);
}

.tx-row-value-copy {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.tx-row-value-copy span {
  font-family: 'SF Mono', ui-monospace, 'Roboto Mono', monospace;
  font-size: 13px;
}

.copy-icon {
  color: var(--text-muted);
  opacity: 0.7;
  flex-shrink: 0;
}

.tx-row-value-verified {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

/* Monochrome, matching BrantaVerifiedBadge's seal exactly — a trust
   signal, not a CTA, so no brand color here either. */
.verified-row-icon {
  color: var(--text-primary);
  flex-shrink: 0;
}

body.body--dark .verified-row-icon {
  color: #C7CCD4;
}

/* Sale breakdown's closing Total row — bolder value, same emphasis
   weight already used elsewhere in this file (.delivery-detail-title). */
.tx-row-total .tx-row-value {
  font-weight: 700;
}

/* ===== Contact Picker Dialog ===== */
.contact-picker-dialog {
  width: 100%;
  max-width: 380px;
  border-radius: 24px;
}

.contact-picker-dialog .dialog-header {
  padding: 20px 20px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contact-picker-dialog .dialog-title {
  flex: 1;
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-weight: 600;
}

.contact-picker-dialog .close-btn {
  width: 32px;
  height: 32px;
  margin-right: -8px;
}

.search-input :deep(.q-field__control) {
  background: var(--bg-input);
  border-radius: var(--radius-md);
  color: var(--text-primary);
}

.contact-list {
  padding: 0;
}

.contact-item {
  border-radius: 12px;
  margin-bottom: 8px;
  padding: 12px;
  background: var(--bg-input);
}

.contact-item:hover {
  background: var(--bg-secondary);
}

.contact-avatar-picker {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: white;
  font-family: 'Manrope', sans-serif;
}

.contact-address-caption {
  font-family: var(--font-mono);
  font-size: 11px;
}

.empty-contacts-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 12px;
}

.empty-contacts-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  color: var(--text-muted);
}

/* ===== Tags Section ===== */
.tags-content {
  padding: 10px 14px;
}

.tag-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-option {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
  font-family: 'Manrope', sans-serif;
  background: var(--bg-input);
  color: var(--text-secondary);
  border-color: var(--bg-input);
}

.tag-option:hover:not(.disabled) {
  background: var(--bg-secondary);
  border-color: var(--text-muted);
}

.tag-option.selected {
  background: rgba(21, 222, 114, 0.15);
  color: var(--color-green);
  border-color: rgba(21, 222, 114, 0.3);
}

.tag-option.disabled {
  opacity: 0.35;
  cursor: default;
}

/* ===== Developer / Technical Section =====
   Rows share the unified .tx-table look above; this section only adds
   the caption spacing and the raw-JSON block underneath. */
.developer-section {
  padding: 0 1rem 1rem 1rem;
}

.raw-section {
  margin-top: 1.25rem;
}

.raw-content {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
}

.raw-text {
  padding: 1rem;
  font-size: 0.75rem;
  overflow-x: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-primary);
}

.copy-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  border-radius: 4px;
  color: var(--text-primary);
}

/* ===== Error State ===== */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
  background: var(--bg-primary);
}

.error-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 1rem 0 0.5rem;
}

.error-subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
}

.go-back-btn {
  border-radius: 24px !important;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #0C0C0C !important;
  font-weight: 600 !important;
  box-shadow: 0px 4px 8px 0px rgba(61, 61, 61, 0.25) !important;
  font-family: 'Manrope', sans-serif !important;
}

/* ===== Responsive Design ===== */
@media (max-width: 480px) {
  .hero-content {
    padding: 24px 16px 20px;
  }

  .hero-amount {
    font-size: 26px;
  }

  .profile-section {
    padding: 1rem 0.75rem;
  }

  .details-section {
    padding: 0 0.75rem;
  }

  .developer-section {
    padding: 0 0.75rem 1rem 0.75rem;
  }

  .tx-row {
    padding: 12px 14px;
  }

  .raw-text {
    font-size: 0.6875rem;
    padding: 0.75rem;
  }

  .settings-card :deep(.q-item) {
    padding: 12px 14px;
    min-height: 44px;
  }
}
</style>
