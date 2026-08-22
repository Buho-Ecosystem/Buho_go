<template>
  <q-page :class="$q.dark.isActive ? 'transaction-history-page-dark' : 'transaction-history-page-light'">
    <!-- Header -->
    <div class="" :class="$q.dark.isActive ? 'page_header_dark' : 'page_header_light'">
      <q-btn
        flat
        round
        dense
        no-caps
        @click="$router.back()"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
      >
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Transactions') }}
      </div>
      <q-btn
        flat
        round
        no-caps
        dense
        @click="$router.push('/wallet')"
        :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M15 5L5 15M5 5L15 15" :stroke="$q.dark.isActive ? 'white' : '#6D6D6D'" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </q-btn>
    </div>

    <!-- Filter Tabs -->
    <div class="filter-section">
      <q-tabs
        v-model="activeFilter"
        dense
        :class="$q.dark.isActive ? 'filter_tabs_dark' : 'filter_tabs_light'"
        indicator-color="transparent"
        align="justify"
        class="q-ma-sm"
      >
        <q-tab
          v-for="tab in filterTabs"
          :key="tab.name"
          :name="tab.name"
          no-caps
          class="q-mx-xs"
          :label="$t(tab.label)"
          :class="activeFilter === tab.name ? ($q.dark.isActive ? 'tab_active_dark' : 'tab_active_light') : ($q.dark.isActive ? 'tab_inactive_dark' : 'tab_inactive_light')"
        />
      </q-tabs>
    </div>

    <!--
      Filter summary: three neutral cards (Net / Received / Sent).
      Each card carries its own fiat line so users have the full
      picture at a glance — no more hunting for the conversion on
      just one card. Direction is shown via a small label icon and
      the signed amount; no coloured accents on the value itself.
    -->
    <div class="stats-section" v-if="activeFilter !== 'all' && filteredTransactions.length > 0">
      <div class="stats-grid">
        <div class="stats-card" :class="$q.dark.isActive ? 'stats-card-dark' : 'stats-card-light'">
          <div class="stats-card-head">
            <Icon
              icon="tabler:arrows-down-up"
              width="13" height="13"
              class="stats-card-head-icon"
              :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'"
            />
            <span class="stats-card-label" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
              {{ $t('Net') }}
            </span>
          </div>
          <div class="stats-card-value" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
            <HiddenAmount>{{ formatAmountWithSign(Math.abs(netAmount), netAmount >= 0) }}</HiddenAmount>
          </div>
          <div class="stats-card-fiat" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
            <HiddenAmount>{{ getFiatAmountForStats(netAmount) }}</HiddenAmount>
          </div>
        </div>

        <div class="stats-card" :class="$q.dark.isActive ? 'stats-card-dark' : 'stats-card-light'">
          <div class="stats-card-head">
            <Icon
              icon="tabler:arrow-down-left"
              width="13" height="13"
              class="stats-card-head-icon stats-card-head-icon-in"
            />
            <span class="stats-card-label" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
              {{ $t('Received') }}
            </span>
          </div>
          <div class="stats-card-value" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
            <HiddenAmount>{{ formatAmountWithSign(totalReceived, true) }}</HiddenAmount>
          </div>
          <div class="stats-card-fiat" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
            <HiddenAmount>{{ getFiatAmountForStats(totalReceived) }}</HiddenAmount>
          </div>
        </div>

        <div class="stats-card" :class="$q.dark.isActive ? 'stats-card-dark' : 'stats-card-light'">
          <div class="stats-card-head">
            <Icon
              icon="tabler:arrow-up-right"
              width="13" height="13"
              class="stats-card-head-icon"
              :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'"
            />
            <span class="stats-card-label" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
              {{ $t('Sent') }}
            </span>
          </div>
          <div class="stats-card-value" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
            <HiddenAmount>{{ formatAmountWithSign(totalSent, false) }}</HiddenAmount>
          </div>
          <div class="stats-card-fiat" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
            <HiddenAmount>{{ getFiatAmountForStats(totalSent) }}</HiddenAmount>
          </div>
        </div>
      </div>
    </div>

    <!-- Pending Bitcoin deposits — share the tx-row base class so the
         two surfaces feel like one list. Ready deposits are clickable
         to trigger the claim sheet; unconfirmed ones surface progress
         via confirmation dots. -->
    <div v-if="pendingBitcoinDeposits.length > 0" class="tx-pending-deposits">
      <div class="tx-pending-header" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
        <span>
          {{ $t('Bitcoin deposits') }}
          <span v-if="pendingBitcoinDeposits.length > 1"> ({{ pendingBitcoinDeposits.length }})</span>
        </span>
        <span v-if="claimableDeposits.length > 0" class="tx-pending-ready">
          {{ claimableDeposits.length }} {{ $t('ready') }}
        </span>
      </div>

      <button
        v-for="deposit in pendingBitcoinDeposits"
        :key="deposit.txId"
        type="button"
        class="tx-row"
        :class="[
          $q.dark.isActive ? 'tx-row-dark' : 'tx-row-light',
          { 'tx-row-ready': deposit.confirmed }
        ]"
        :disabled="!deposit.confirmed && !claimingTxId"
        @click="deposit.confirmed && initiateClaimDeposit(deposit)"
      >
        <span class="tx-row-icon-wrap">
          <span
            class="tx-row-icon tx-row-icon-bitcoin"
            :class="[
              $q.dark.isActive ? 'tx-row-icon-dark' : 'tx-row-icon-light',
              deposit.confirmed ? 'tx-row-icon-in' : 'tx-row-icon-out'
            ]"
          >
            <Icon icon="tabler:currency-bitcoin" width="18" height="18" />
          </span>
        </span>

        <span class="tx-row-body">
          <span class="tx-row-title" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
            {{ $t('Bitcoin deposit') }}
          </span>
          <span class="tx-row-sub" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
            <template v-if="deposit.confirmed">
              <Icon icon="tabler:circle-check" width="13" height="13" class="tx-row-sub-icon tx-row-sub-icon-ready" />
              {{ $t('Ready to claim') }}
            </template>
            <template v-else>
              <span class="tx-conf-dots" aria-hidden="true">
                <span class="tx-conf-dot" :class="{ 'tx-conf-dot-active': deposit.confirmations >= 1 }" />
                <span class="tx-conf-dot" :class="{ 'tx-conf-dot-active': deposit.confirmations >= 2 }" />
                <span class="tx-conf-dot" :class="{ 'tx-conf-dot-active': deposit.confirmations >= 3 }" />
              </span>
              {{ deposit.confirmations }}/3 {{ $t('confirmations') }}
            </template>
          </span>
        </span>

        <span class="tx-row-amount-col">
          <span class="tx-row-amount" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
            <HiddenAmount>+{{ formatAmount(deposit.amount) }}</HiddenAmount>
          </span>
          <span v-if="deposit.confirmed" class="tx-deposit-action">
            <q-btn
              size="sm"
              no-caps
              unelevated
              dense
              class="tx-claim-btn"
              :loading="claimingTxId === deposit.txId"
              @click.stop="initiateClaimDeposit(deposit)"
            >
              {{ $t('Claim') }}
            </q-btn>
          </span>
          <span v-else class="tx-row-fiat" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
            {{ $t('Confirming...') }}
          </span>
        </span>
      </button>
    </div>

    <!-- Claim Confirmation - iOS Action Sheet Style -->
    <q-dialog v-model="showClaimDialog" position="bottom" transition-show="slide-up" transition-hide="slide-down">
      <q-card class="claim-action-sheet" :class="$q.dark.isActive ? 'sheet-dark' : 'sheet-light'">
        <!-- Handle Bar -->
        <div class="sheet-handle">
          <div class="handle-bar"></div>
        </div>

        <!-- Amount Display -->
        <div class="claim-amount-display">
          <div class="claim-amount-value" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            +{{ formatAmount(netClaimAmount) }}
          </div>
          <div class="claim-amount-label" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
            {{ $t('will be added to your wallet') }}
          </div>
        </div>

        <!-- Fee Summary -->
        <div class="claim-fee-summary" :class="$q.dark.isActive ? 'summary-dark' : 'summary-light'">
          <div class="fee-line">
            <span class="fee-label">{{ $t('Deposit') }}</span>
            <span class="fee-value">{{ formatAmount(claimingDeposit?.amount || 0) }}</span>
          </div>
          <div class="fee-line deduction">
            <span class="fee-label">{{ $t('Network fee') }}</span>
            <span class="fee-value">-{{ formatAmount(claimFeeAmount) }}</span>
          </div>
        </div>

        <!-- High Fee Notice -->
        <div v-if="isHighClaimFee" class="high-fee-notice">
          <Icon icon="tabler:alert-circle" width="16" height="16" />
          <span>{{ $t('High fee relative to deposit') }}</span>
        </div>

        <!-- Action Buttons -->
        <div class="claim-sheet-actions">
          <q-btn
            unelevated
            no-caps
            class="claim-confirm-btn"
            :loading="isClaimingDeposit"
            @click="confirmClaimDeposit"
          >
            {{ $t('Add to Wallet') }}
          </q-btn>
          <q-btn
            flat
            no-caps
            class="claim-cancel-btn"
            :class="$q.dark.isActive ? 'cancel-dark' : 'cancel-light'"
            @click="cancelClaim"
          >
            {{ $t('Cancel') }}
          </q-btn>
        </div>

        <!-- Return to Sender Option -->
        <div class="refund-option">
          <q-btn
            flat
            no-caps
            dense
            class="refund-link"
            :class="$q.dark.isActive ? 'refund-dark' : 'refund-light'"
            @click="showRefundConfirmation"
          >
            {{ $t("Don't want it? Return to sender") }}
          </q-btn>
        </div>
      </q-card>
    </q-dialog>

    <!-- Refund Confirmation Dialog -->
    <q-dialog v-model="showRefundDialog" persistent>
      <q-card class="refund-dialog" :class="$q.dark.isActive ? 'dialog-dark' : 'dialog-light'">
        <q-card-section class="refund-header">
          <Icon icon="tabler:arrow-back-up" :style="{ fontSize: '48px' }" class="refund-icon" />
          <div class="refund-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ $t('Return this Bitcoin?') }}
          </div>
        </q-card-section>

        <q-card-section class="refund-body">
          <p :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('This will send the Bitcoin back to whoever sent it to you.') }}
          </p>
          <p :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('You will not receive any sats from this deposit.') }}
          </p>
          <div class="refund-amount-box" :class="$q.dark.isActive ? 'box-dark' : 'box-light'">
            <span class="refund-amount-label">{{ $t('Amount being returned') }}</span>
            <span class="refund-amount-value">{{ formatAmount(claimingDeposit?.amount || 0) }}</span>
          </div>

          <!-- Advanced: send to a different on-chain address. Hidden by
               default — most users want the "back to sender" path, which
               we derive from the deposit's first input automatically. -->
          <button
            type="button"
            class="refund-advanced-toggle"
            :class="$q.dark.isActive ? 'toggle-dark' : 'toggle-light'"
            @click="refundShowAdvanced = !refundShowAdvanced"
          >
            <Icon
              icon="tabler:chevron-down"
              :class="['refund-advanced-chev', { flipped: refundShowAdvanced }]"
              width="14"
              height="14"
            />
            <span>{{ $t('Advanced') }}</span>
          </button>

          <transition name="refund-advanced-fade">
            <div v-if="refundShowAdvanced" class="refund-advanced-panel" :class="$q.dark.isActive ? 'panel-dark' : 'panel-light'">
              <label class="refund-advanced-label">
                {{ $t('Send to a different Bitcoin address') }}
              </label>
              <input
                v-model="refundCustomAddress"
                type="text"
                spellcheck="false"
                autocapitalize="off"
                autocomplete="off"
                :placeholder="$t('bc1...')"
                class="refund-advanced-input"
                :class="$q.dark.isActive ? 'input-dark' : 'input-light'"
              />
              <p class="refund-advanced-hint">
                {{ $t('Leave empty to send back to the original sender.') }}
              </p>
            </div>
          </transition>
        </q-card-section>

        <q-card-actions class="refund-actions">
          <q-btn
            flat
            no-caps
            class="refund-keep-btn"
            :class="$q.dark.isActive ? 'keep-dark' : 'keep-light'"
            @click="showRefundDialog = false"
          >
            {{ $t('Keep it') }}
          </q-btn>
          <q-btn
            unelevated
            no-caps
            class="refund-confirm-btn"
            :loading="isRefundingDeposit"
            @click="confirmRefundDeposit"
          >
            {{ $t('Yes, return it') }}
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Bitcoin Claim Success Animation -->
    <PaymentConfirmation
      v-model="showClaimSuccess"
      :amount="claimSuccessAmount"
      :label="$t('Bitcoin Claimed')"
      accent-color="orange"
      :auto-close-delay="4"
      @closed="onClaimSuccessClosed"
    />

    <!-- Skeleton loading state — wraps in .tx-groups > .tx-group > .tx-rows
         so it inherits the same horizontal padding (16px) and inter-row
         gap (8px) as the live list, giving a seamless hand-off when real
         data lands. -->
    <div v-if="showLoadingScreen || isLoading" class="transaction-content" :class="$q.dark.isActive ? 'transaction_content_dark' : 'transaction_content_light'">
      <div class="tx-groups">
        <div class="tx-group">
          <div class="tx-group-header-skeleton" :class="$q.dark.isActive ? 'tx-group-header-dark' : 'tx-group-header-light'">
            <q-skeleton type="text" width="80px" height="14px" animation="wave" />
            <q-skeleton type="text" width="44px" height="14px" animation="wave" />
          </div>
          <div class="tx-rows">
            <div
              v-for="n in 6"
              :key="'skel-'+n"
              class="tx-row tx-row-skeleton"
              :class="$q.dark.isActive ? 'tx-row-dark' : 'tx-row-light'"
            >
              <span class="tx-row-icon-wrap">
                <q-skeleton type="circle" size="36px" animation="wave" />
              </span>
              <span class="tx-row-body">
                <q-skeleton type="text" width="60%" height="14px" animation="wave" />
                <q-skeleton type="text" width="35%" height="12px" animation="wave" />
              </span>
              <span class="tx-row-amount-col">
                <q-skeleton type="text" width="68px" height="14px" animation="wave" />
                <q-skeleton type="text" width="46px" height="12px" animation="wave" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Transaction List with Pull-to-Refresh -->
    <q-scroll-area
      class="transaction-content"
      :class="$q.dark.isActive ? 'transaction_content_dark' : 'transaction_content_light'"
      v-else-if="filteredTransactions.length > 0"
    >
      <q-pull-to-refresh @refresh="onPullToRefresh" color="primary">
      <div class="tx-groups">
        <div
          v-for="group in groupedTransactions"
          :key="group.date"
          class="tx-group"
        >
          <!-- Day header: a plain section label (Today / Yesterday / date).
               Not collapsible — the day anchor is orientation, not chrome,
               and rows must stay scannable without extra taps. -->
          <div
            v-if="!group.isFlat"
            class="tx-group-header"
            :class="$q.dark.isActive ? 'tx-group-header-dark' : 'tx-group-header-light'"
          >
            <span class="tx-group-date">{{ group.dateLabel }}</span>
          </div>

          <!-- Group transactions -->
          <q-slide-transition>
            <div v-show="group.expanded || group.isFlat" class="tx-rows">
              <template v-for="tx in group.transactions" :key="tx.id">
                <!-- Regular row -->
                <button
                  v-if="!tx.isGroup"
                  type="button"
                  class="tx-row"
                  :class="[
                    $q.dark.isActive ? 'tx-row-dark' : 'tx-row-light',
                    { 'tx-row-pending': tx.status === 'pending' }
                  ]"
                  @click="viewTransaction(tx)"
                >
                  <!-- Icon / avatar -->
                  <span class="tx-row-icon-wrap">
                    <ContactAvatar
                      v-if="getContactForTransaction(tx)"
                      class="tx-row-avatar"
                      :entry="getContactForTransaction(tx)"
                      :initial-length="2"
                    />
                    <!--
                      A Learn & Earn reward has no counterparty address for
                      the avatar chain below to resolve, so it carries the
                      BuhoGO mark. It sits after the contact branch because
                      nothing auto-stamps a contact on an incoming payment:
                      one being there means the user assigned it, and that
                      outranks our branding. Plain <img> rather than
                      ContactAvatar because that component's picture prop
                      only accepts https/data URLs, not an asset path.
                    -->
                    <span v-else-if="isEarnRewardTx(tx)" class="tx-row-icon tx-row-icon-earn">
                      <img :src="earnBrandLogo" class="tx-row-earn-logo" alt="" aria-hidden="true" />
                    </span>
                    <ContactAvatar
                      v-else-if="getTxAvatarPicture(tx)"
                      class="tx-row-avatar"
                      :picture="getTxAvatarPicture(tx)"
                      :entry="{ address: getTxCounterparty(tx) }"
                      :name="txTitle(tx).kind === 'message' ? '' : txTitle(tx).full"
                      :initial-length="2"
                    />
                    <!-- Status rows (awaiting / expired) keep the icon
                         circle — a clock says more than a silhouette
                         there. Every completed row is avatar-first: the
                         person/brand carries identity, the corner badge
                         below carries the movement type. -->
                    <span
                      v-else-if="tx.status !== 'completed'"
                      class="tx-row-icon"
                      :class="[
                        $q.dark.isActive ? 'tx-row-icon-dark' : 'tx-row-icon-light',
                        `tx-row-icon-${getTxDirection(tx)}`,
                        { 'tx-row-icon-bitcoin': isBitcoinTransaction(tx) }
                      ]"
                    >
                      <Icon :icon="getTxIcon(tx)" width="18" height="18" />
                    </span>
                    <ContactAvatar
                      v-else
                      class="tx-row-avatar"
                      :entry="{ address: getTxCounterparty(tx) }"
                    />
                    <!-- Movement-type badge (received / sent / POS /
                         batch / transfer / zap) riding the avatar corner. -->
                    <span
                      v-if="getTxBadge(tx)"
                      class="tx-row-type-badge"
                      :class="getTxBadge(tx).cls"
                    >
                      <Icon :icon="getTxBadge(tx).icon" width="10" height="10" />
                    </span>
                  </span>

                  <!-- Text column -->
                  <span class="tx-row-body">
                    <span class="tx-row-title-row">
                      <!-- Names and memos shorten at the end, where the
                           least meaning sits. An address shortens in the
                           middle instead, so both the person and the
                           service they were paid at stay readable. Both
                           halves stay in the DOM, so screen readers and
                           the details view still get the whole string. -->
                      <span
                        v-if="txTitle(tx).parts"
                        class="tx-row-title tx-row-title-split"
                        :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'"
                      >
                        <span class="tx-row-title-head">{{ txTitle(tx).parts.head }}</span
                        ><span class="tx-row-title-tail">{{ txTitle(tx).parts.tail }}</span>
                      </span>
                      <!-- A message is quoted and unbolded so it reads as
                           something someone wrote, never as a contact the
                           user saved. See resolveTxTitle(). -->
                      <span
                        v-else
                        class="tx-row-title"
                        :class="[
                          $q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light',
                          { 'tx-row-title-message': txTitle(tx).kind === 'message' }
                        ]"
                      >
                        <template v-if="txTitle(tx).kind === 'message'">&#8220;{{ txTitle(tx).full }}&#8221;</template>
                        <template v-else>{{ txTitle(tx).full }}</template>
                      </span>
                      <!-- L1 badge — calls out on-chain transactions
                           (deposits + cooperative-exit withdrawals) so a
                           user scanning history can tell on-chain apart
                           from Lightning at a glance. Survives the
                           post-claim transition because the claimed-tx
                           ids are persisted to localStorage. -->
                      <span
                        v-if="isBitcoinTransaction(tx)"
                        class="tx-l1-badge"
                        :class="$q.dark.isActive ? 'tx-l1-badge-dark' : 'tx-l1-badge-light'"
                      >
                        {{ $t('On-chain') }}
                      </span>
                      <!-- Source chip — same visual as the L1 badge, marking
                           rows written by an auxiliary payment path (internal
                           transfer, batch send, kiosk sale). At most one chip
                           per row; on-chain wins when both would apply. -->
                      <span
                        v-else-if="getTxSourceChip(tx)"
                        class="tx-l1-badge"
                        :class="$q.dark.isActive ? 'tx-l1-badge-dark' : 'tx-l1-badge-light'"
                      >
                        {{ getTxSourceChip(tx) }}
                      </span>
                    </span>
                    <span class="tx-row-sub" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
                      {{ getTxSubtitle(tx) }}
                    </span>
                  </span>

                  <!--
                    Amount column.

                    Headline shows the *recipient amount* (what the
                    user typed when sending), not the gross deducted.
                    The fee, when present, surfaces as a small inline
                    note on the existing fiat sub-line so the user
                    can reconcile "I sent X, the network took Y" at
                    a glance — without adding a new row of vertical
                    chrome. Spark-to-Spark and incoming transactions
                    omit the fee badge entirely (getFeeBadge returns
                    '').
                  -->
                  <span class="tx-row-amount-col">
                    <span
                      class="tx-row-amount"
                      :class="[
                        $q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light',
                        {
                          'tx-row-amount-in': tx.type === 'incoming' && tx.status === 'completed',
                          'tx-row-amount-out': tx.type === 'outgoing' && tx.status === 'completed'
                        }
                      ]"
                    >
                      <HiddenAmount>{{ getFormattedAmount(tx) }}</HiddenAmount>
                    </span>
                    <span class="tx-row-fiat" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
                      <HiddenAmount>{{ getFiatAmount(tx) }}</HiddenAmount><template v-if="getFeeBadge(tx)"> · {{ getFeeBadge(tx) }}</template>
                    </span>
                  </span>
                </button>

                <!-- Micropayment group -->
                <div v-if="tx.isGroup" class="tx-micro">
                  <button
                    type="button"
                    class="tx-row tx-micro-header"
                    :class="[
                      $q.dark.isActive ? 'tx-row-dark' : 'tx-row-light',
                      { 'tx-micro-open': expandedMicropaymentGroups.has(tx.id) }
                    ]"
                    @click="toggleMicropaymentGroup(tx.id)"
                  >
                    <span class="tx-row-icon-wrap">
                      <ContactAvatar
                        v-if="getContactForGroup(tx)"
                        class="tx-row-avatar"
                        :entry="getContactForGroup(tx)"
                        :initial-length="2"
                      />
                      <span
                        v-else
                        class="tx-row-icon"
                        :class="[
                          $q.dark.isActive ? 'tx-row-icon-dark' : 'tx-row-icon-light',
                          `tx-row-icon-${tx.transactionType === 'incoming' ? 'in' : 'out'}`
                        ]"
                      >
                        <Icon icon="tabler:stack-2" width="18" height="18" />
                      </span>
                    </span>
                    <span class="tx-row-body">
                      <span class="tx-row-title" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
                        {{ tx.count }} {{ tx.transactionType === 'incoming' ? $t('payments from') : $t('payments to') }}
                        {{ getGroupRecipientDisplay(tx) }}
                      </span>
                      <span class="tx-row-sub" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
                        {{ formatRelativeTime(tx.startTime) }}
                      </span>
                    </span>
                    <span class="tx-row-amount-col">
                      <span class="tx-row-amount" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
                        <HiddenAmount>{{ formatAmountWithSign(tx.totalAmount, tx.transactionType === 'incoming') }}</HiddenAmount>
                      </span>
                      <Icon
                        :icon="expandedMicropaymentGroups.has(tx.id) ? 'tabler:chevron-up' : 'tabler:chevron-down'"
                        width="14" height="14"
                        class="tx-micro-chevron"
                      />
                    </span>
                  </button>

                  <q-slide-transition>
                    <div v-show="expandedMicropaymentGroups.has(tx.id)" class="tx-micro-items">
                      <button
                        v-for="innerTx in tx.transactions"
                        :key="innerTx.id"
                        type="button"
                        class="tx-micro-item"
                        :class="$q.dark.isActive ? 'tx-row-dark' : 'tx-row-light'"
                        @click="viewTransaction(innerTx)"
                      >
                        <span class="tx-micro-item-time" :class="$q.dark.isActive ? 'tx-row-muted-dark' : 'tx-row-muted-light'">
                          {{ formatShortTime(innerTx.settled_at) }}
                        </span>
                        <span class="tx-micro-item-amount" :class="$q.dark.isActive ? 'tx-row-title-dark' : 'tx-row-title-light'">
                          <HiddenAmount>{{ formatAmountWithSign(innerTx.amount, innerTx.type === 'incoming') }}</HiddenAmount>
                        </span>
                      </button>
                    </div>
                  </q-slide-transition>
                </div>
              </template>
            </div>
          </q-slide-transition>
        </div>
      </div>

      <!-- Load More Button -->
      <div v-if="hasMoreTransactions && activeFilter === 'all'" class="load-more-section">
        <q-btn
          flat
          no-caps
          :loading="isLoadingMore"
          class="load-more-btn"
          :class="$q.dark.isActive ? 'load-more-dark' : 'load-more-light'"
          @click="loadMoreTransactions"
        >
          <Icon icon="tabler:circle-plus" width="18" height="18" class="q-mr-sm" />
          {{ $t('Load More') }}
        </q-btn>
      </div>

      <!-- End of List Indicator -->
      <div v-else-if="!hasMoreTransactions && transactions.length > 20" class="end-of-list">
        <span :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">
          {{ $t('All transactions loaded') }}
        </span>
      </div>

      </q-pull-to-refresh>
    </q-scroll-area>

    <!-- Empty State -->
    <div v-else-if="filteredTransactions.length === 0"
         :class="$q.dark.isActive ? 'empty_state_dark' : 'empty_state_light'">
      <img
        src="/Onboarding wizard spark/storyset-receipt-bro.svg"
        class="empty-illustration-img"
        alt=""
        aria-hidden="true"
      />
      <div class="empty-title" :class="$q.dark.isActive ? 'empty_title_dark' : 'empty_title_light'">
        {{ activeFilter === 'all' ? $t('No transactions yet') : $t('No transactions found') }}
      </div>
      <div class="empty-subtitle" :class="$q.dark.isActive ? 'empty_subtitle_dark' : 'empty_subtitle_light'">
        {{
          activeFilter === 'all'
            ? $t('Send or receive your first payment and it will show up here.')
            : $t('No transactions for') + ' ' + $t(activeFilter)
        }}
      </div>
      <q-btn
        @click="loadTransactions"
        :class="$q.dark.isActive ? 'btn_dark' : 'btn_light'"
        no-caps
      >
        <Icon icon="tabler:refresh" width="16" height="16" class="q-mr-xs" />
        {{ $t('Refresh') }}
      </q-btn>
    </div>

  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import PaymentConfirmation from '../components/PaymentConfirmation.vue';
import ContactAvatar from '../components/AddressBook/ContactAvatar.vue';
import HiddenAmount from '../components/HiddenAmount.vue';
import { fiatRatesService } from '../utils/fiatRates.js';
import { formatAmount as formatAmountUtil, formatAmountWithPrefix } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { useAddressBookStore } from '../stores/addressBook';
import { useTransactionMetadataStore } from '../stores/transactionMetadata';
import { normalizeTx } from '../services/txNormalizer.js';
import { formatRelativeTime, formatShortTime, formatHumanDateTime } from '../utils/timeFormatting';
import { groupMicropayments } from '../composables/useTransactionGrouping';
import { matchLnAddressService } from '../services/lnAddressServices';
import { EARN_BRAND, isEarnRewardTx, earnRewardKind } from '../services/earnBrand';
import { zapInfoFromTx } from '../utils/zaps';
import { zapperDisplayName, zapperPicture } from '../services/zapperProfiles';
import { NOSTRICH_HEAD_ICON } from '../utils/nostrIcon.js';
import { splitAddressForDisplay } from '../utils/addressUtils.js';
import { getTxDescription, getTxMessage as resolveTxMessage, isPlaceholderDescription } from '../utils/txMessage.js';

// Chip text per metadata source (i18n message keys, resolved through $t at
// render time). Lookup map on purpose: later passes stamp more sources
// (e.g. 'nostr', 'phone') and only need a new entry here, no logic change.
const TX_SOURCE_CHIP_KEYS = {
  'internal-transfer': 'Transfer',
  'social-bucket': 'Profile payout',
  batch: 'Batch',
  kiosk: 'Kiosk',
  nostr: 'Nostr',
  phone: 'Phone',
};

// Row icon override per metadata source. Sources without an entry keep the
// default direction arrows (batch intentionally has none — the recipient
// avatar or arrow already tells the story).
const TX_SOURCE_ICONS = {
  'internal-transfer': 'tabler:arrows-exchange',
  'social-bucket': 'tabler:user-dollar',
  kiosk: 'tabler:building-store',
};

export default {
  name: 'TransactionHistoryPage',
  components: {
    PaymentConfirmation,
    ContactAvatar,
    HiddenAmount,
  },
  data() {
    return {
      isLoading: true,
      isRefreshing: false,
      activeFilter: 'week',
      transactions: [],
      walletState: {},
      walletStore: null,
      addressBookStore: null,
      metadataStore: null,
      expandedGroups: new Set(),
      expandedMicropaymentGroups: new Set(),
      showLoadingScreen: true,
      filterTabs: [
        {name: 'all', label: 'All'},
        {name: 'today', label: 'Today'},
        {name: 'week', label: 'Week'},
        {name: 'month', label: 'Month'}
      ],
      fiatRates: {},
      loadingFiatRates: true,
      // Batching state
      isLoadingMore: false,
      batchSize: 20,
      currentOffset: 0,
      isFetchingMore: false,
      hasMoreTransactions: true,
      backgroundFetchAborted: false,
      // Pending Bitcoin deposits
      pendingBitcoinDeposits: [],
      claimingTxId: null,
      showClaimDialog: false,
      claimingDeposit: null,
      claimFeeQuote: null,
      isClaimingDeposit: false,
      // Claim success animation
      showClaimSuccess: false,
      claimSuccessAmount: 0,
      // Track the deposit txId being claimed for reliable matching
      lastClaimedDepositTxId: null,
      // Refund dialog state
      showRefundDialog: false,
      isRefundingDeposit: false,
      // Optional manual destination override (advanced disclosure).
      // Empty string means "auto-derive from the deposit's first input".
      refundShowAdvanced: false,
      refundCustomAddress: ''
    }
  },

  // Constants for Bitcoin L1 handling
  BITCOIN_REQUIRED_CONFIRMATIONS: 3,
  CLAIMED_TX_STORAGE_LIMIT: 100,
  CLAIM_MATCH_TIME_WINDOW_SECONDS: 300,
  computed: {
    /** BuhoGO mark shown on Learn & Earn reward rows. */
    earnBrandLogo() {
      return EARN_BRAND.logo;
    },

    /**
     * The wallet this page is rendering. TransactionHistory always shows
     * exactly one wallet's list (this.walletState.activeWalletId,
     * refreshed at the top of loadTransactions), so every metadata
     * read/write here is scoped to it. This is what stops a note/tag/
     * contact written from this page leaking onto another wallet's
     * transaction that happens to share the same provider-assigned id
     * (see transactionMetadata.js).
     */
    historyWalletId() {
      return this.walletState?.activeWalletId || null;
    },

    filteredTransactions() {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      return this.transactions.filter(tx => {
        const txDate = new Date(tx.settled_at * 1000);

        switch (this.activeFilter) {
          case 'today':
            return txDate >= today;
          case 'week':
            return txDate >= sevenDaysAgo;
          case 'month':
            return txDate >= monthAgo;
          default:
            return true;
        }
      });
    },

    /**
     * Row titles, resolved once per list pass. resolveTxTitle() reaches into the
     * metadata store and the address book for every row, so the template must
     * not call it again for each half of a middle-truncated address.
     */
    txTitles() {
      const map = new Map();
      for (const tx of this.filteredTransactions || []) {
        if (!tx || !tx.id) continue;
        map.set(tx.id, this.decorateTxTitle(this.resolveTxTitle(tx)));
      }
      return map;
    },

    groupedTransactions() {
      // Safety check
      if (!this.filteredTransactions || this.filteredTransactions.length === 0) {
        return [{
          date: 'flat',
          dateLabel: '',
          transactions: [],
          netAmount: 0,
          expanded: true,
          isFlat: true
        }];
      }

      // Collapse bursts of payments with the same counterparty (a stream of
      // tips, a shop's rapid-fire sales) into one expandable row.
      //
      // minGroupSize is 4, not 2: the grouper no longer requires the payments
      // to be strictly adjacent, so a low threshold would fold two ordinary
      // payments that merely share a counterparty into a group and HIDE
      // detail the user expects to see. Clutter starts with a burst, and a
      // burst is more than a pair.
      const groupedWithMicropayments = groupMicropayments(this.filteredTransactions, {
        timeWindowSeconds: 3600,
        descriptionSimilarity: 0.75,
        minGroupSize: 4,
        enabled: true
      });

      // Time sections anchor rows: a bare "02:16" on a row from three days
      // ago reads as today's. Day sections for the short-range filters;
      // the unbounded "All" view sections by month instead, so years of
      // history stay scannable without hundreds of day headers.
      const byMonth = this.activeFilter === 'all';
      const groups = {};

      groupedWithMicropayments.forEach(tx => {
        // Use endTime for groups, settled_at for regular transactions
        const timestamp = tx.isGroup ? tx.endTime : tx.settled_at;
        const date = new Date(timestamp * 1000);
        const groupKey = byMonth
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        if (!groups[groupKey]) {
          groups[groupKey] = {
            date: groupKey,
            dateLabel: byMonth ? this.formatMonthLabel(date) : this.formatDayLabel(date),
            transactions: [],
            netAmount: 0,
            expanded: true
          };
        }

        groups[groupKey].transactions.push(tx);

        // Calculate net amount
        if (tx.isGroup) {
          groups[groupKey].netAmount += tx.transactionType === 'incoming' ? tx.totalAmount : -tx.totalAmount;
        } else {
          groups[groupKey].netAmount += tx.type === 'incoming' ? Math.abs(tx.amount) : -Math.abs(tx.amount);
        }
      });

      return Object.values(groups)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(group => ({
          ...group,
          transactions: group.transactions.sort((a, b) => {
            const aTime = a.isGroup ? a.endTime : a.settled_at;
            const bTime = b.isGroup ? b.endTime : b.settled_at;
            return bTime - aTime;
          })
        }));
    },

    // Stats chips count settled money only — pending invoices (which may
    // never be paid) and expired ones must not inflate the totals.
    totalReceived() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'incoming' && tx.status === 'completed')
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    },

    totalSent() {
      return this.filteredTransactions
        .filter(tx => tx.type === 'outgoing' && tx.status === 'completed')
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    },

    netAmount() {
      return this.totalReceived - this.totalSent;
    },

    // Claim dialog computed properties
    netClaimAmount() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return 0;
      return this.claimFeeQuote.creditAmountSats || 0;
    },

    claimFeeAmount() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return 0;
      return Math.max(0, this.claimingDeposit.amount - (this.claimFeeQuote.creditAmountSats || 0));
    },

    isHighClaimFee() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return false;
      return this.claimFeeAmount > (this.claimingDeposit.amount * 0.5);
    },

    claimableDeposits() {
      return this.pendingBitcoinDeposits.filter(d => d.confirmed);
    },

    activeWalletName() {
      return this.walletStore?.activeWallet?.name || 'Wallet';
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

    this.initializeTransactionHistory();
    this.loadFiatRates();
    this.loadPendingDeposits();
  },

  beforeUnmount() {
    // Abort any ongoing background fetch when component is destroyed
    this.backgroundFetchAborted = true;
  },

  watch: {
    'fiatRates': {
      handler() {
        this.$forceUpdate();
      },
      deep: true
    }
  },
  methods: {
    /**
     * A Learn & Earn reward, recognised by the stable memo the earn store
     * bakes into every reward invoice (see services/earnBrand.js).
     */
    isEarnRewardTx(tx) {
      return isEarnRewardTx(tx);
    },

    /**
     * Localised row title for a reward, or '' when the tx is not one. The
     * invoice memo itself stays untranslated so it keeps matching after a
     * language change; the label the user reads is resolved here instead.
     */
    getEarnRewardTitle(tx) {
      const kind = earnRewardKind(tx);
      if (!kind) return '';
      return kind === 'bonus'
        ? this.$t('Learn & Earn bonus')
        : this.$t('Learn & Earn reward');
    },

    async initializeTransactionHistory() {
      try {
        await this.loadTransactions();
        this.showLoadingScreen = false;
      } catch (error) {
        console.error('Error initializing transaction history:', error);
        this.showLoadingScreen = false;
      }
    },

    // New helper methods for redesigned transaction cards

    getContactForTransaction(tx) {
      if (!tx || !tx.id || !this.metadataStore) return null;
      try {
        // Single source of truth: the store getter resolves an explicit
        // contactId, then a manual removal, then the durable recipient
        // address live against the address book.
        return this.metadataStore.getContactForTransaction(tx.id, this.historyWalletId);
      } catch (error) {
        console.error('Error getting contact for transaction:', error);
        return null;
      }
    },

    /**
     * Contact for a micropayment group. A group is, by construction,
     * repeated payments to the same recipient, so any member that
     * resolves identifies the whole group. Falls back to the group's
     * recipient string when no member is stamped yet.
     */
    getContactForGroup(group) {
      if (!group || !this.metadataStore) return null;
      try {
        const members = Array.isArray(group.transactions) ? group.transactions : [];
        for (const inner of members) {
          const contact = this.metadataStore.getContactForTransaction(inner.id, this.historyWalletId);
          if (contact) return contact;
        }
        if (group.recipient && this.addressBookStore) {
          return this.addressBookStore.findContactByAddress(group.recipient);
        }
        return null;
      } catch (error) {
        return null;
      }
    },

    getTagsForTransaction(tx) {
      if (!tx || !tx.id || !this.metadataStore) return [];
      try {
        return this.metadataStore.getTagsForTransaction(tx.id, this.historyWalletId) || [];
      } catch (error) {
        console.error('Error getting tags for transaction:', error);
        return [];
      }
    },

    // ------------------------------------------------------------------
    // Row presentation helpers. Kept small and explicit so the row
    // template stays declarative: each row asks the method for a title,
    // a subtitle, and a direction tag and renders them. All the type-
    // discrimination (pending, auto-withdraw, contact, etc.) is here.
    // ------------------------------------------------------------------

    /**
     * The counterparty we sent to, when known. Stamped as durable
     * metadata at send time (recipientAddress survives even when no
     * contact exists yet). Outgoing only: on receives the only address
     * on the record is our own (the lnurlp address that was paid),
     * which is not a counterparty.
     */
    getTxCounterparty(tx) {
      if (!tx || tx.type !== 'outgoing' || !tx.id || !this.metadataStore) return '';
      try {
        const meta = this.metadataStore.getMetadataForTransaction(tx.id, this.historyWalletId);
        return meta?.recipientAddress || '';
      } catch (error) {
        return '';
      }
    },

    /**
     * The human message riding on a transaction: the payer's LUD-12
     * comment when there is one, else the invoice memo. Returns '' when
     * neither exists — never invents text.
     */
    getTxMessage(tx) {
      if (!tx) return '';
      // A zap's human message is the request's content — the note the
      // zapper attached ("Great note! ⚡"). Its description is machine
      // payload, so the shared resolver must not see it.
      const zap = this.getTxZap(tx);
      if (zap) return zap.note || '';
      return resolveTxMessage(tx);
    },

    /**
     * The metadata label stamped on a transaction by an auxiliary send
     * path (internal transfer, batch, kiosk). '' when unset.
     */
    getTxMetadataLabel(tx) {
      if (!tx || !tx.id || !this.metadataStore) return '';
      try {
        return this.metadataStore.getLabelForTransaction(tx.id, this.historyWalletId) || '';
      } catch (error) {
        return '';
      }
    },

    /**
     * The machine-readable metadata source of a transaction
     * ('internal-transfer' | 'batch' | 'kiosk' | ...). '' when unset.
     */
    getTxMetadataSource(tx) {
      if (!tx || !tx.id || !this.metadataStore) return '';
      try {
        return this.metadataStore.getSourceForTransaction(tx.id, this.historyWalletId) || '';
      } catch (error) {
        return '';
      }
    },

    /**
     * Translated chip text for the row's metadata source, or '' when the
     * tx has none (or an unknown one — future-proof against new enums).
     */
    getTxSourceChip(tx) {
      const key = TX_SOURCE_CHIP_KEYS[this.getTxMetadataSource(tx)];
      return key ? this.$t(key) : '';
    },

    /**
     * The row avatar picture when there's no assigned contact but we still
     * know who this was: a resolved Nostr counterparty's profile picture
     * (stamped at send time for bare npub/nprofile/NIP-05 sends), or, for
     * the phone-number payout rail, the provider's bundled logo. null when
     * neither applies — the row then falls back to the plain direction icon.
     * The row also passes `:entry="{ address }"` alongside this so
     * ContactAvatar's own bundled provider-logo lookup can resolve the
     * phone-rail case — its explicit `picture` URL gate only accepts
     * https/data URLs, not a bundled asset path.
     */
    getTxAvatarPicture(tx) {
      if (!tx || !tx.id || !this.metadataStore) return null;
      try {
        const avatar = this.metadataStore.getCounterpartyAvatarForTransaction(tx.id, this.historyWalletId);
        if (avatar?.picture) return avatar.picture;
        // Zap: the zapper's profile picture, once the relays answered.
        // Reactive through the zapperProfiles cache — rows upgrade from
        // silhouette to face in place.
        const zap = this.getTxZap(tx);
        if (zap) {
          const picture = zapperPicture(zap);
          if (picture) return picture;
        }
        if (this.metadataStore.getSourceForTransaction(tx.id, this.historyWalletId) === 'phone') {
          const address = this.getTxCounterparty(tx);
          if (address) {
            const svc = matchLnAddressService(address);
            return svc?.logo || svc?.flag || null;
          }
        }
        return null;
      } catch (error) {
        return null;
      }
    },

    /**
     * The top line of a transaction row, plus what kind of thing it is.
     *
     * Priority, first hit wins: pending/expired status → contact name →
     * metadata label (internal transfer / batch / kiosk) → Learn & Earn
     * reward → auto-withdraw note → zap sender → recipient address
     * (sends only) → the payment's own message → a generic direction
     * label.
     *
     * The `kind` matters as much as the text. It decides two things the
     * caller cannot infer from the string:
     *
     *   - `address` is the only kind that shortens in the middle. A
     *     message that happens to contain no spaces must not be sliced
     *     like a Lightning address.
     *   - `message` is counterparty-written text. It earns the top line
     *     when nothing identifies the sender — which is almost every
     *     receive, since a recipient address is stamped on sends only —
     *     but it is rendered quoted and unbolded so it can never pass
     *     for a contact the user saved. A stranger who pays with the
     *     comment "Mom" must not read as Mom.
     *
     * @param {object} tx
     * @returns {{ full: string, kind: 'status'|'name'|'address'|'message'|'generic' }}
     */
    resolveTxTitle(tx) {
      if (!tx) return { full: '', kind: 'generic' };
      if (tx.status === 'pending') {
        return {
          full: tx.type === 'incoming' ? this.$t('Awaiting payment') : this.$t('Sending...'),
          kind: 'status'
        };
      }
      if (tx.status === 'expired') return { full: this.$t('Invoice expired'), kind: 'status' };

      const contact = this.getContactForTransaction(tx);
      if (contact) return { full: contact.name, kind: 'name' };

      const label = this.getTxMetadataLabel(tx);
      if (label) return { full: label, kind: 'name' };

      // Below anything the user assigned, but above the message fallback:
      // otherwise the row leaks the raw, untranslated invoice memo.
      const earnTitle = this.getEarnRewardTitle(tx);
      if (earnTitle) return { full: earnTitle, kind: 'name' };

      if (this.isAutoWithdraw(tx)) {
        const note = this.getAutoWithdrawNote(tx);
        return { full: note || this.$t('Auto-Transfer'), kind: 'name' };
      }

      // Zap: the row is about WHO zapped. Resolved profile name when the
      // relays have answered, a shortened npub until then — reactive, so
      // the row upgrades in place the moment the profile lands. Sits
      // below contact (a saved zapper keeps their local name) and above
      // every generic fallback.
      const zap = this.getTxZap(tx);
      if (zap) {
        return { full: zapperDisplayName(zap) || this.$t('Zap received'), kind: 'name' };
      }

      // Sends answer "who did I pay", so the address outranks the memo.
      const counterparty = this.getTxCounterparty(tx);
      if (counterparty) return { full: counterparty, kind: 'address' };

      const message = this.getTxMessage(tx);
      if (message) return { full: message, kind: 'message' };

      if (this.isBitcoinTransaction(tx)) {
        return {
          full: tx.type === 'incoming' ? this.$t('Bitcoin received') : this.$t('Bitcoin sent'),
          kind: 'generic'
        };
      }
      // Nothing identified this payment: no contact, no address, no text.
      // Direction is already carried three ways — the signed amount, its
      // colour, and the arrow badge on the avatar — so naming it again
      // here would spend the row's most prominent line on a fact the
      // reader has already read.
      return { full: this.$t('Bitcoin payment'), kind: 'generic' };
    },

    /**
     * The resolved row title: `full` and `kind`, plus `parts` when it is
     * an address that should shorten in the middle rather than at the
     * end (null otherwise). Reads the cached pass above; falls back for
     * any row the cache misses, such as a transaction reached from
     * outside the filtered list.
     */
    txTitle(tx) {
      const cached = tx && tx.id ? this.txTitles.get(tx.id) : null;
      if (cached) return cached;
      return this.decorateTxTitle(this.resolveTxTitle(tx));
    },

    /**
     * Add the display-only `parts` split to a resolved title. Only an
     * address is ever split: it is the one kind whose tail (the domain,
     * or a token's last characters) carries as much meaning as its head.
     *
     * @param {{ full: string, kind: string }} title
     */
    decorateTxTitle(title) {
      return {
        ...title,
        parts: title.kind === 'address' ? splitAddressForDisplay(title.full) : null
      };
    },

    /**
     * The text that did not fit in the title, when the title is already
     * carrying this payment's message.
     *
     * A payment can hold both a payer comment and an invoice
     * description. The comment leads, because a comment is always
     * something a person chose to write, while a description is often
     * whatever the receiving app filled in. The description then keeps
     * the caption instead of being dropped. '' when there is no second,
     * distinct piece of text.
     */
    getTxSecondaryMessage(tx) {
      if (!tx || this.getTxZap(tx)) return '';
      const description = getTxDescription(tx);
      if (!description || description === this.getTxMessage(tx)) return '';
      return description;
    },

    /**
     * The secondary caption: the transaction's message in quotes,
     * separated from the time HH:MM. The same text never appears twice
     * in one row — when the title already carries the message, only a
     * second, distinct piece of text earns the quote slot.
     */
    getTxSubtitle(tx) {
      if (!tx) return '';
      const time = this.formatShortTime(tx.settled_at);
      if (tx.status === 'pending') return time;

      // A kiosk sale that took a tip says so at a glance, in place of the
      // usual quoted comment/memo slot — a kiosk invoice never has one
      // anyway (its description is the generic "Kiosk Payment").
      const tipNote = this.getKioskTipSubtitle(tx);
      if (tipNote) return `${tipNote} · ${time}`;

      const comment = String(tx.comment || '').trim();

      // The title already carries the localised reward label, so the raw
      // (untranslated) invoice memo must never be echoed underneath it.
      if (this.isEarnRewardTx(tx)) {
        return comment ? `“${comment}” · ${time}` : time;
      }

      const message = this.txTitle(tx).kind === 'message'
        ? this.getTxSecondaryMessage(tx)
        : this.getTxMessage(tx);

      return message ? `“${message}” · ${time}` : time;
    },

    /**
     * "Tip 10%" when the sale took a percentage tip, or "Tip ₿ 12" (the
     * plain amount) when the uplift came from round-up instead. '' for
     * every non-kiosk transaction, or a kiosk sale with no tip at all —
     * both fall through to the normal comment/memo subtitle above.
     */
    getKioskTipSubtitle(tx) {
      if (!tx || !tx.id || !this.metadataStore) return '';
      if (this.getTxMetadataSource(tx) !== 'kiosk') return '';
      try {
        const breakdown = this.metadataStore.getSaleBreakdownForTransaction(tx.id, this.historyWalletId);
        if (!breakdown || !(Number(breakdown.tipSats) > 0)) return '';
        const amount = breakdown.tipPercent != null
          ? `${breakdown.tipPercent}%`
          : this.formatAmount(breakdown.tipSats);
        return `${this.$t('Tip')} ${amount}`;
      } catch (error) {
        return '';
      }
    },

    /**
     * 'in' | 'out' — drives the icon choice (arrow direction) and the
     * subtle accent on the icon circle. Incoming earns a gentle green
     * tint so direction is legible at scan time; outgoing stays neutral.
     */
    getTxDirection(tx) {
      return tx?.type === 'incoming' ? 'in' : 'out';
    },

    /**
     * The avatar-corner type badge: one small mark that says what kind
     * of movement this was, so direction survives even when the avatar
     * is a face or a brand logo. Exactly one badge per row; specificity
     * order: zap → POS/aux source → plain direction. Completed rows
     * only — pending/expired rows keep the status icon circle instead.
     */
    getTxBadge(tx) {
      if (!tx || tx.status !== 'completed') return null;
      if (this.getTxZap(tx)) {
        return { icon: NOSTRICH_HEAD_ICON, cls: 'tx-badge-zap' };
      }
      const source = this.getTxMetadataSource(tx);
      if (source === 'kiosk') return { icon: 'tabler:building-store', cls: 'tx-badge-pos' };
      if (source === 'batch') return { icon: 'tabler:stack-2', cls: 'tx-badge-aux' };
      if (source === 'internal-transfer') return { icon: 'tabler:arrows-exchange', cls: 'tx-badge-aux' };
      if (source === 'social-bucket') return { icon: 'tabler:user-dollar', cls: 'tx-badge-aux' };
      return tx.type === 'incoming'
        ? { icon: 'tabler:arrow-down-left', cls: 'tx-badge-in' }
        : { icon: 'tabler:arrow-up-right', cls: 'tx-badge-out' };
    },

    /**
     * Iconify name for the left-side icon circle. Single icon system
     * (tabler) for visual rhythm — replaces the mix of raw SVG paths
     * the old layout used.
     */
    getTxIcon(tx) {
      if (!tx) return 'tabler:dots';
      if (this.isPendingInvoice(tx)) return 'tabler:clock';
      if (tx.status === 'pending') return 'tabler:clock';
      if (tx.status === 'expired') return 'tabler:clock-x';
      if (this.isAutoWithdraw(tx)) return 'tabler:send';
      if (this.isBitcoinTransaction(tx)) return 'tabler:currency-bitcoin';
      const sourceIcon = TX_SOURCE_ICONS[this.getTxMetadataSource(tx)];
      if (sourceIcon) return sourceIcon;
      if (tx.senderNpub) return 'tabler:bolt';
      return tx.type === 'incoming' ? 'tabler:arrow-down-left' : 'tabler:arrow-up-right';
    },

    formatRelativeTime(timestamp) {
      if (!timestamp) return '';
      try {
        return formatRelativeTime(timestamp);
      } catch (error) {
        console.error('Error formatting relative time:', error);
        return '';
      }
    },

    formatShortTime(timestamp) {
      if (!timestamp) return '';
      try {
        return formatShortTime(timestamp);
      } catch (error) {
        console.error('Error formatting short time:', error);
        return '';
      }
    },

    /**
     * Section label for the "All" view's month groups: a localized
     * "July 2026".
     */
    formatMonthLabel(date) {
      const locale = this.$i18n?.locale || 'en-US';
      return date.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
    },

    /**
     * Section label for a day group: Today / Yesterday / a localized
     * date ("Jul 11", with the year appended once it differs).
     */
    formatDayLabel(date) {
      const now = new Date();
      const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
      if (dayDiff === 0) return this.$t('Today');
      if (dayDiff === 1) return this.$t('Yesterday');
      const locale = this.$i18n?.locale || 'en-US';
      const opts = { month: 'short', day: 'numeric' };
      if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
      return date.toLocaleDateString(locale, opts);
    },

    formatHumanDateTime(timestamp) {
      if (!timestamp) return '';
      try {
        return formatHumanDateTime(timestamp);
      } catch (error) {
        console.error('Error formatting human date time:', error);
        return '';
      }
    },

    toggleMicropaymentGroup(groupId) {
      if (this.expandedMicropaymentGroups.has(groupId)) {
        this.expandedMicropaymentGroups.delete(groupId);
      } else {
        this.expandedMicropaymentGroups.add(groupId);
      }
      this.$forceUpdate(); // Force re-render to show/hide expansion
    },

    getGroupRecipientDisplay(group) {
      if (!group) return 'unknown';

      try {
        // 1. A contact already resolved for any member transaction names
        // the whole group, same as the row avatar right above it.
        const contact = this.getContactForGroup(group);
        if (contact?.name) {
          return contact.name;
        }

        // 2. A zap stream groups per zapper (grouping keys on
        // senderNpub). Show the resolved profile name — a raw npub as
        // the group title would defeat the whole identity effort.
        if (group.recipient && group.recipient.startsWith('npub1')) {
          const name = zapperDisplayName({ npub: group.recipient });
          if (name) return name;
        }

        // 3. group.recipient is extractRecipient()'s pick, which now
        // prefers the stable counterpartyKey stamped in normalizeForList.
        // A Lightning address is immediately recognisable, so show it
        // as-is instead of falling through to the description.
        if (group.recipient && group.recipient.includes('@')) {
          return group.recipient;
        }

        // 4. If it's a hash or too long, use the description instead —
        // unless the description is one of the placeholder memos, which
        // names nobody and would read as "3 payments from BuhoGO Payment".
        let recipient = group.recipient || '';
        if (!recipient || recipient.length > 20 || recipient.startsWith('lnbc')) {
          recipient = isPlaceholderDescription(group.description) ? '' : group.description;
        }

        // Truncate if still too long
        if (recipient && recipient.length > 30) {
          return recipient.substring(0, 27) + '...';
        }

        return recipient || 'unknown';
      } catch (error) {
        console.error('Error getting group recipient display:', error);
        return 'unknown';
      }
    },

    // Auto-assign contacts from address book
    async autoAssignContacts() {
      if (!this.transactions || !this.addressBookStore || !this.metadataStore) {
        return;
      }

      // First pass: drain pending-contact links queued by the send
      // flow. This stamps outgoing txs whose recipient we already
      // knew at send time but whose provider-assigned id we couldn't
      // predict. Reliable for every wallet rail because we match on
      // amount + recent timestamp, not on a derived id.
      try {
        await this.metadataStore.consumePendingContactLinks(this.transactions, this.historyWalletId);
      } catch (err) {
        console.warn('[txHistory] pending-contact-link drain failed:', err);
      }

      console.log('Auto-assigning contacts for transactions...');
      let assignedCount = 0;

      for (const tx of this.transactions) {
        try {
          // Skip if already assigned
          const existingMetadata = this.metadataStore.getMetadataForTransaction(tx.id, this.historyWalletId);
          if (existingMetadata?.contactId) {
            continue;
          }

          // Try to find a matching contact
          let matchedContact = null;

          // 1. Check for Nostr zap sender
          if (tx.senderNpub) {
            // Look for contact with matching npub in notes or address
            matchedContact = this.addressBookStore.entries.find(contact =>
              contact.notes?.includes(tx.senderNpub) ||
              contact.address?.includes(tx.senderNpub)
            );
          }

          // 2. Check description/memo for Lightning address
          if (!matchedContact) {
            const desc = tx.description || tx.memo || '';
            const lightningAddressMatch = desc.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

            if (lightningAddressMatch) {
              const address = lightningAddressMatch[0].toLowerCase();
              matchedContact = this.addressBookStore.entries.find(contact =>
                contact.address?.toLowerCase() === address
              );
            }
          }

          // 3. Check payment_request for matches (first few chars)
          if (!matchedContact && tx.payment_request) {
            const invoicePrefix = tx.payment_request.substring(0, 20);
            matchedContact = this.addressBookStore.entries.find(contact =>
              contact.notes?.includes(invoicePrefix)
            );
          }

          // If we found a match, auto-assign it
          if (matchedContact) {
            await this.metadataStore.setContactForTransaction(tx.id, this.historyWalletId, matchedContact.id);
            assignedCount++;
            console.log(`Auto-assigned contact "${matchedContact.name}" to transaction ${tx.id}`);
          }
        } catch (error) {
          console.error(`Error auto-assigning contact for transaction ${tx.id}:`, error);
        }
      }

      if (assignedCount > 0) {
        console.log(`Auto-assigned ${assignedCount} contacts`);
        this.$forceUpdate(); // Refresh UI to show assigned contacts
      }
    },

    async loadTransactions() {
      this.isLoading = true;

      // Reset batching state
      this.resetBatchingState();

      try {
        // Load wallet state for fiat currency preference
        const savedState = localStorage.getItem('buhoGO_wallet_state');
        if (savedState) {
          this.walletState = JSON.parse(savedState);
        }

        // Phase 1: Load first batch (fast, always happens)
        await this.loadFirstBatch();

        this.transactions.sort((a, b) => b.settled_at - a.settled_at);

        this.processZapTransactions();

        // Auto-assign contacts from address book
        await this.autoAssignContacts();

        // Phase 2: If on "All" tab, load remaining batches in background
        if (this.activeFilter === 'all' && this.hasMoreTransactions) {
          this.$nextTick(() => {
            this.loadRemainingBatchesInBackground();
          });
        }

      } catch (error) {
        console.error('Error loading transactions:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t load history'),
        });
      } finally {
        this.isLoading = false;
      }
    },

    // Batching helper methods
    resetBatchingState() {
      this.currentOffset = 0;
      this.hasMoreTransactions = true;
      this.isFetchingMore = false;
      this.backgroundFetchAborted = false;
      this.transactions = [];
    },

    async loadFirstBatch() {
      console.log('Loading first batch of transactions...');

      if (this.walletStore.isActiveWalletSpark) {
        await this.loadSparkTransactionsBatch();
      } else if (this.walletStore.isActiveWalletArkade) {
        await this.loadArkadeTransactionsBatch();
      } else if (this.walletStore.isActiveWalletLNBits) {
        await this.loadLNBitsTransactionsBatch();
      } else {
        await this.loadNWCTransactionsBatch();
      }

      console.log(`First batch loaded: ${this.transactions.length} transactions`);
    },

    async loadRemainingBatchesInBackground() {
      if (this.isFetchingMore || this.backgroundFetchAborted) {
        return;
      }

      this.isFetchingMore = true;
      console.log('Starting background fetch for remaining transactions...');

      try {
        let batchCount = 1;
        const maxBatches = 250; // Safety limit: 250 batches × 20 = 5000 transactions max

        while (this.hasMoreTransactions && batchCount < maxBatches && !this.backgroundFetchAborted) {
          // Small delay to avoid overwhelming wallet
          await this.sleep(100);

          const beforeCount = this.transactions.length;

          if (this.walletStore.isActiveWalletSpark) {
            await this.loadSparkTransactionsBatch();
          } else if (this.walletStore.isActiveWalletArkade) {
            await this.loadArkadeTransactionsBatch();
          } else if (this.walletStore.isActiveWalletLNBits) {
            await this.loadLNBitsTransactionsBatch();
          } else {
            await this.loadNWCTransactionsBatch();
          }

          const afterCount = this.transactions.length;
          const fetchedInBatch = afterCount - beforeCount;

          console.log(`Background batch ${batchCount}: fetched ${fetchedInBatch} transactions (total: ${afterCount})`);

          // Sort and process new transactions
          this.transactions.sort((a, b) => b.settled_at - a.settled_at);
          this.processZapTransactions();
          await this.autoAssignContacts();

          batchCount++;
        }

        if (batchCount >= maxBatches) {
          console.warn('Reached maximum batch limit (5000 transactions)');
        }

        console.log(`Background fetch complete: ${this.transactions.length} total transactions`);
      } catch (error) {
        console.error('Error during background fetch:', error);
      } finally {
        this.isFetchingMore = false;
      }
    },

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Stable counterparty key for the micropayment grouper (see
     * useTransactionGrouping's extractRecipient, which prefers this over
     * its own per-payment heuristics). Outgoing: the recipient address
     * stamped as metadata at send time. Incoming: the canonical
     * `tx.lnaddress` - the Lightning address that was PAID, i.e. OUR OWN
     * receiving address, not the payer's identity. Grouping incoming
     * payments by "landed on the same address of ours" is exactly the
     * streaming-burst signal we want; it does not claim the payers are
     * the same person. null when neither is known - never invented.
     */
    getCounterpartyKeyForGrouping(tx) {
      if (!tx) return null;
      try {
        let key = null;
        if (tx.type === 'outgoing' && tx.id && this.metadataStore) {
          key = this.metadataStore.getMetadataForTransaction(tx.id, this.historyWalletId)?.recipientAddress || null;
        } else if (tx.type === 'incoming') {
          key = tx.lnaddress || null;
        }
        return key ? String(key).toLowerCase().trim() : null;
      } catch (error) {
        return null;
      }
    },

    /**
     * One canonical mapping for every provider's raw tx (see
     * services/txNormalizer.js). Merges the stored fiat-at-settlement
     * snapshot for providers that don't report one, and queues a stamp
     * for genuinely fresh settlements so the rate is captured while it
     * still matches the settlement moment.
     */
    normalizeForList(rawTx, walletType) {
      const stored = this.metadataStore?.getFiatAtSettlementForTransaction(rawTx?.id, this.historyWalletId) || null;
      const tx = normalizeTx(rawTx, { walletType, fiatAtSettlement: stored });
      if (this.metadataStore && !tx.fiatAtSettlement) {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        this.metadataStore.stampFreshTransactions([tx], this.historyWalletId, currency).catch(() => {});
      }
      // NIP-57: an incoming payment whose description is a kind-9734 zap
      // request is a zap. Stamp senderNpub here — grouping keys off it
      // (zap streams group per zapper) and TransactionDetails reads it.
      const zap = this.getTxZap(tx);
      if (zap?.npub && !tx.senderNpub) tx.senderNpub = zap.npub;
      tx.counterpartyKey = this.getCounterpartyKeyForGrouping(tx);
      return tx;
    },

    /**
     * Zap info for a row (utils/zaps), memoized per tx id — the parse
     * involves JSON work and rows re-render on scroll. null for
     * everything that isn't a received zap.
     */
    getTxZap(tx) {
      if (!tx || tx.type !== 'incoming') return null;
      const key = tx.id || tx.paymentHash;
      if (!key) return zapInfoFromTx(tx);
      if (!this._zapMemo) this._zapMemo = new Map();
      if (!this._zapMemo.has(key)) this._zapMemo.set(key, zapInfoFromTx(tx));
      return this._zapMemo.get(key);
    },

    async loadSparkTransactionsBatch() {
      // Check if Spark wallet needs PIN unlock
      if (this.walletStore.needsPinEntry) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Wallet locked'),
          caption: this.$t('Please unlock your Spark wallet to view transactions'),

          timeout: 3000,
        });
        this.$router.push('/wallet');
        this.hasMoreTransactions = false;
        return;
      }

      // Ensure Spark wallet is connected
      const provider = await this.walletStore.ensureSparkConnected();

      if (!provider) {
        throw new Error('Could not connect to Spark wallet');
      }

      // Fetch batch with current offset
      const sparkTransactions = await provider.getTransactions({
        limit: this.batchSize,
        offset: this.currentOffset
      });

      if (!sparkTransactions || sparkTransactions.length === 0) {
        this.hasMoreTransactions = false;
        return;
      }

      // Normalize and append to transactions array
      const normalizedTransactions = sparkTransactions.map(tx => this.normalizeForList(tx, 'spark'));

      this.transactions.push(...normalizedTransactions);
      this.currentOffset += this.batchSize;

      // Check if we got fewer transactions than requested (end of list)
      if (sparkTransactions.length < this.batchSize) {
        this.hasMoreTransactions = false;
      }
    },

    async loadNWCTransactionsBatch() {
      const activeWallet = this.walletState.connectedWallets?.find(
        w => w.id === this.walletState.activeWalletId
      );

      if (!activeWallet?.nwcString) {
        throw new Error('No active NWC wallet found');
      }

      const nwc = new NostrWebLNProvider({
        nostrWalletConnectUrl: activeWallet.nwcString,
      });

      await nwc.enable();

      // Fetch batch with current offset
      const transactionsResponse = await nwc.listTransactions({
        limit: this.batchSize,
        offset: this.currentOffset
      });

      if (!transactionsResponse || !transactionsResponse.transactions || transactionsResponse.transactions.length === 0) {
        this.hasMoreTransactions = false;
        return;
      }

      // Normalize and append to transactions array.
      //
      // Note on units: NIP-47 reports `amount` and `fees_paid` in
      // millisatoshis, BUT the @getalby/sdk NostrWebLNProvider that
      // backs LightningPaymentService converts msats→sats
      // internally (see `mapNip47TransactionToTransaction` in the
      // SDK source). Values arrive in sats — no further unit
      // conversion needed here.
      const normalizedTransactions = transactionsResponse.transactions.map(tx => this.normalizeForList({
        ...tx,
        id: tx.id || tx.payment_hash || `tx-${Date.now()}-${Math.random()}`,
        fee: tx.fee || tx.fees_paid || 0,
        payment_request: tx.payment_request || tx.invoice || null
      }, 'nwc'));

      console.log(`NWC batch loaded: ${normalizedTransactions.length} transactions`);

      this.transactions.push(...normalizedTransactions);
      this.currentOffset += this.batchSize;

      // Check if we got fewer transactions than requested (end of list)
      if (transactionsResponse.transactions.length < this.batchSize) {
        this.hasMoreTransactions = false;
      }
    },

    async loadLNBitsTransactionsBatch() {
      // Ensure LNbits wallet is connected
      const activeWallet = this.walletStore.activeWallet;
      if (!activeWallet) {
        throw new Error('No active LNbits wallet found');
      }

      let provider = this.walletStore.providers[activeWallet.id];
      if (!provider) {
        // Try to connect
        await this.walletStore.connectLNBitsWallet(activeWallet.id);
        provider = this.walletStore.providers[activeWallet.id];
      }

      if (!provider) {
        throw new Error('Could not connect to LNbits wallet');
      }

      // Fetch batch with current offset
      const lnbitsTransactions = await provider.getTransactions({
        limit: this.batchSize,
        offset: this.currentOffset
      });

      if (!lnbitsTransactions || lnbitsTransactions.length === 0) {
        this.hasMoreTransactions = false;
        return;
      }

      // Normalize and append to transactions array
      const normalizedTransactions = lnbitsTransactions.map(tx => this.normalizeForList(tx, 'lnbits'));

      console.log(`LNbits batch loaded: ${normalizedTransactions.length} transactions`);

      this.transactions.push(...normalizedTransactions);
      this.currentOffset += this.batchSize;

      // Check if we got fewer transactions than requested (end of list)
      if (lnbitsTransactions.length < this.batchSize) {
        this.hasMoreTransactions = false;
      }
    },

    /**
     * Arkade history. The SDK's getTransactionHistory returns the full list
     * (no offset/limit), so we fetch once and mark the list complete — there
     * are no further batches to page through.
     */
    async loadArkadeTransactionsBatch() {
      const activeWallet = this.walletStore.activeWallet;
      if (!activeWallet) {
        this.hasMoreTransactions = false;
        return;
      }

      // Already fetched the whole history on the first call.
      if (this.currentOffset > 0) {
        this.hasMoreTransactions = false;
        return;
      }

      let provider = this.walletStore.providers[activeWallet.id];
      if (!provider) {
        await this.walletStore.connectArkadeWallet(activeWallet.id);
        provider = this.walletStore.providers[activeWallet.id];
      }
      if (!provider) {
        throw new Error('Could not connect to Arkade wallet');
      }

      const arkadeTransactions = await provider.getTransactions();
      this.currentOffset += this.batchSize;
      this.hasMoreTransactions = false;

      if (!arkadeTransactions || arkadeTransactions.length === 0) {
        return;
      }

      const normalizedTransactions = arkadeTransactions.map(tx => this.normalizeForList(tx, 'arkade'));

      console.log(`Arkade batch loaded: ${normalizedTransactions.length} transactions`);
      this.transactions.push(...normalizedTransactions);
    },

    async refreshTransactions() {
      // Abort any ongoing background fetch
      this.backgroundFetchAborted = true;

      this.isRefreshing = true;
      await this.loadTransactions();
      this.isRefreshing = false;

      this.$q.notify({
        type: 'positive',
        message: this.$t('Up to date'),

        timeout: 1500,
      });
    },

    /**
     * Pull-to-refresh handler
     */
    async onPullToRefresh(done) {
      try {
        // Abort any ongoing background fetch
        this.backgroundFetchAborted = true;
        await this.loadTransactions();
      } finally {
        done();
      }
    },

    /**
     * Load more transactions (next batch)
     */
    async loadMoreTransactions() {
      if (this.isLoadingMore || !this.hasMoreTransactions) return;

      this.isLoadingMore = true;
      try {
        if (this.walletStore.isActiveWalletSpark) {
          await this.loadSparkTransactionsBatch();
        } else if (this.walletStore.isActiveWalletArkade) {
          await this.loadArkadeTransactionsBatch();
        } else if (this.walletStore.isActiveWalletLNBits) {
          await this.loadLNBitsTransactionsBatch();
        } else {
          await this.loadNWCTransactionsBatch();
        }
      } catch (error) {
        console.error('Error loading more transactions:', error);
      } finally {
        this.isLoadingMore = false;
      }
    },

    /**
     * Tag zap rows with the sender's npub. Identity itself (name,
     * picture) is resolved by services/zapperProfiles from real relay
     * data at render time, so nothing is fetched or invented here.
     */
    processZapTransactions() {
      for (const tx of this.transactions) {
        if (this.isZapTransaction(tx)) {
          const npub = this.extractNpubFromZap(tx);
          if (npub) tx.senderNpub = npub;
        }
      }
    },

    isZapTransaction(tx) {
      return tx.description && (
        tx.description.toLowerCase().includes('zap') ||
        tx.description.includes('⚡') ||
        tx.type === 'incoming' && tx.description.match(/npub1[a-zA-Z0-9]{58}/)
      );
    },

    extractNpubFromZap(tx) {
      const npubMatch = tx.description.match(/npub1[a-zA-Z0-9]{58}/);
      return npubMatch ? npubMatch[0] : null;
    },

    toggleGroup(dateKey) {
      if (dateKey === 'flat') return;

      if (this.expandedGroups.has(dateKey)) {
        this.expandedGroups.delete(dateKey);
      } else {
        this.expandedGroups.add(dateKey);
      }

      const group = this.groupedTransactions.find(g => g.date === dateKey);
      if (group) {
        group.expanded = this.expandedGroups.has(dateKey);
      }
    },

    isPendingInvoice(tx) {
      return tx.status === 'pending' && tx.type === 'incoming';
    },

    isAutoWithdraw(tx) {
      const tags = this.getTagsForTransaction(tx);
      return tags.includes('auto-withdraw');
    },

    getAutoWithdrawNote(tx) {
      if (!tx?.id || !this.metadataStore) return null;
      try {
        return this.metadataStore.getNoteForTransaction(tx.id, this.historyWalletId) || null;
      } catch { return null; }
    },

    getTransactionTypeText(tx) {
      if (this.isPendingInvoice(tx)) return this.$t('Invoice created');
      if (this.isAutoWithdraw(tx)) return this.$t('Auto-Transfer');
      // Check for Bitcoin (L1) transactions
      if (this.isBitcoinTransaction(tx)) {
        return tx.type === 'incoming' ? this.$t('Bitcoin Deposit') : this.$t('Bitcoin Withdrawal');
      }
      return tx.type === 'incoming' ? this.$t('Received') : this.$t('Sent');
    },

    getTransactionIconClass(tx) {
      if (this.isPendingInvoice(tx)) return 'tx-icon-pending-invoice';
      if (this.isAutoWithdraw(tx)) return 'tx-icon-auto-withdraw';
      if (this.isBitcoinTransaction(tx)) return 'tx-icon-bitcoin';
      if (tx.senderNpub) return 'tx-icon-zap';
      return tx.type === 'incoming' ? 'tx-icon-received' : 'tx-icon-sent';
    },

    getTransactionIcon(tx) {
      if (this.isPendingInvoice(tx)) return 'tabler:clock';
      if (this.isAutoWithdraw(tx)) return 'tabler:send';
      if (this.isBitcoinTransaction(tx)) return 'tabler:currency-bitcoin';
      if (tx.senderNpub) return 'tabler:bolt';
      return tx.type === 'incoming' ? 'tabler:arrow-down' : 'tabler:arrow-up';
    },

    /**
     * Get indicator class for transaction avatar
     * Auto-withdraw: indigo (auto-withdraw)
     * Pending invoices: muted amber (awaiting-payment)
     * Bitcoin deposits: orange (bitcoin-deposit)
     * Bitcoin withdrawals: gray (outgoing)
     * Regular: green (incoming) or gray (outgoing)
     */
    getIndicatorClass(tx) {
      if (this.isPendingInvoice(tx)) return 'awaiting-payment';
      if (this.isAutoWithdraw(tx)) return 'auto-withdraw';
      if (this.isBitcoinTransaction(tx)) {
        return tx.type === 'incoming' ? 'bitcoin-deposit' : 'outgoing';
      }
      return tx.type;
    },

    /**
     * Check if transaction is a Bitcoin L1 deposit/withdrawal
     */
    isBitcoinTransaction(tx) {
      if (!tx) return false;

      // Check if this transaction ID was marked as a Bitcoin claim
      const claimedIds = this.getClaimedBitcoinTxIds();
      if (claimedIds.includes(tx.id)) {
        return true;
      }

      // Check rawType or type from Spark SDK
      const rawType = (tx.rawType || '').toLowerCase();
      if (rawType.includes('l1') || rawType.includes('deposit') || rawType.includes('withdrawal') ||
          rawType.includes('coop_exit') || rawType.includes('static_deposit') ||
          rawType.includes('coop_close') || rawType.includes('claim')) {
        return true;
      }

      // Check description/memo
      const desc = (tx.description || tx.memo || '').toLowerCase();
      if (desc.includes('bitcoin deposit') || desc.includes('bitcoin withdrawal') ||
          desc.includes('l1 deposit') || desc.includes('l1 withdrawal') ||
          desc.includes('on-chain') || desc.includes('onchain')) {
        return true;
      }

      return false;
    },

    /**
     * Get list of transaction IDs that were claimed Bitcoin deposits
     */
    getClaimedBitcoinTxIds() {
      try {
        const stored = localStorage.getItem('buhoGO_claimed_bitcoin_txs');
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    },

    /**
     * Mark a transaction ID as a claimed Bitcoin deposit
     */
    markAsClaimedBitcoin(txId) {
      if (!txId) return;

      try {
        const ids = this.getClaimedBitcoinTxIds();
        if (!ids.includes(txId)) {
          ids.push(txId);
          // Keep only last N entries to prevent storage bloat
          const limit = this.$options.CLAIMED_TX_STORAGE_LIMIT || 100;
          const trimmed = ids.slice(-limit);
          localStorage.setItem('buhoGO_claimed_bitcoin_txs', JSON.stringify(trimmed));
        }
      } catch (error) {
        console.error('Failed to store claimed Bitcoin tx:', error);
      }
    },

    getAmountClass(tx) {
      if (this.isPendingInvoice(tx)) return 'amount-pending';
      return tx.type === 'incoming' ? 'amount-positive' : 'amount-negative';
    },

    /**
     * The "user-meaningful" amount in sats for a list row:
     *
     *   - Outgoing with a fee → recipient amount (gross − fee).
     *     Matches what the user typed when they hit Send, and stays
     *     consistent with TransactionDetails' hero.
     *   - Otherwise → gross amount unchanged.
     *
     * Pure derivation — does NOT mutate tx. Stats-card aggregates
     * (Total Sent / Net) keep summing `tx.amount` directly so the
     * card totals continue to match the real balance delta.
     *
     * @param {object} tx
     * @returns {number} non-negative sats
     */
    getDisplayAmountSats(tx) {
      // The normalizer computed the recipient amount with the correct
      // per-provider fee semantics (Spark's amount includes the fee,
      // LNbits/NWC exclude it) — trust it when present.
      if (Number.isFinite(Number(tx?.recipientSats))) {
        return Math.abs(Number(tx.recipientSats));
      }
      const gross = Math.abs(Number(tx?.amount) || 0);
      const fee = Number(tx?.fee) || 0;
      if (tx?.type === 'outgoing' && fee > 0) {
        return Math.max(0, gross - fee);
      }
      return gross;
    },

    getFormattedAmount(tx) {
      const prefix = tx.type === 'incoming' ? '+' : '-';
      return formatAmountWithPrefix(this.getDisplayAmountSats(tx), this.walletStore.useBip177Format, prefix);
    },

    /**
     * Inline fee note appended to the row's fiat sub-line so the
     * user can see at a glance "I sent 5, the network took 4 on
     * top" without opening the detail page.
     *
     * Wrapped in parentheses on purpose: a bare "+4 sats" next to a
     * fiat figure can be misread as positive income. Parens read as
     * a side note instead of a math operator.
     *
     * Returns an empty string when there's no fee to surface
     * (incoming, Spark-to-Spark, unsettled state); the template
     * uses that to suppress both the separator and the badge.
     *
     * @param {object} tx
     * @returns {string}  e.g. "(₿ 4 fee)" / "(4 sats fee)", or "".
     */
    getFeeBadge(tx) {
      // feeSats is null (not 0) when the provider genuinely doesn't
      // report a fee (Arkade) — suppress the badge rather than claim
      // a free payment.
      const fee = Number(tx?.feeSats ?? tx?.fee) || 0;
      if (tx?.type !== 'outgoing' || fee <= 0) return '';
      const feeAmount = formatAmountUtil(fee, this.walletStore.useBip177Format);
      return `(${feeAmount} ${this.$t('fee')})`;
    },

    formatAmount(amount) {
      return formatAmountUtil(Math.abs(amount), this.walletStore.useBip177Format);
    },

    formatAmountWithSign(amount, isPositive) {
      const sign = isPositive ? '+' : '-';
      return formatAmountWithPrefix(Math.abs(amount), this.walletStore.useBip177Format, sign);
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

    getFiatAmount(tx) {
      if (this.loadingFiatRates) {
        return '...';
      }

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        // Fiat tracks the row's headline amount so they can't disagree.
        // For an outgoing payment with a fee, both reflect what the
        // recipient received (gross − fee), not the gross deducted.
        const fiatValue = fiatRatesService.convertSatsToFiatSync(this.getDisplayAmountSats(tx), currency);

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

    getFiatAmountForStats(amount) {
      if (this.loadingFiatRates) {
        return '...';
      }

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatValue = fiatRatesService.convertSatsToFiatSync(Math.abs(amount), currency);

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

    formatTime(timestamp) {
      const date = new Date(timestamp * 1000);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    },

    viewTransaction(tx) {
      // Carry the owning wallet so the details page resolves the tx
      // against THIS wallet instead of whatever is active by then.
      const walletId = this.walletState.activeWalletId || '';
      this.$router.push(`/transaction/${tx.id}?wallet=${encodeURIComponent(walletId)}`);
    },

    // ==========================================
    // Pending Bitcoin Deposits Methods
    // ==========================================

    async loadPendingDeposits() {
      if (!this.walletStore.isActiveWalletSpark) return;

      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (provider?.getPendingDeposits) {
          this.pendingBitcoinDeposits = await provider.getPendingDeposits();
        }
      } catch (error) {
        console.warn('Failed to load pending deposits:', error);
      }
    },

    async initiateClaimDeposit(deposit) {
      // Validate deposit is confirmed before proceeding
      if (!deposit || !deposit.confirmed) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Deposit not ready'),
          caption: this.$t('Please wait for more confirmations'),

        });
        return;
      }

      this.claimingTxId = deposit.txId;
      try {
        const provider = await this.walletStore.ensureSparkConnected();
        const quote = await provider.getClaimFeeQuote(deposit.txId, deposit.outputIndex);

        this.claimingDeposit = deposit;
        this.claimFeeQuote = quote;
        this.showClaimDialog = true;
      } catch (error) {
        this.walletStore.showPaymentError(error, {
          context: 'l1',
          route: 'L1 claim fee quote',
          t: this.$t.bind(this),
        });
      } finally {
        this.claimingTxId = null;
      }
    },

    async confirmClaimDeposit() {
      if (!this.claimingDeposit || !this.claimFeeQuote) return;

      this.isClaimingDeposit = true;
      const claimedAmount = this.claimFeeQuote.creditAmountSats || this.claimingDeposit.amount;
      const claimedTxId = this.claimingDeposit.txId;

      try {
        const provider = await this.walletStore.ensureSparkConnected();
        const result = await provider.claimDeposit(
          this.claimingDeposit.txId,
          this.claimFeeQuote, // Pass the full quote with creditAmountSats and signature
          this.claimingDeposit.outputIndex
        );

        // Close claim dialog first
        this.showClaimDialog = false;

        // If claim is processing (race condition with background stream), show info message
        if (result.processing) {
          this.$q.notify({
            type: 'info',
            message: this.$t('Claim processing'),
            caption: this.$t('Your sats will arrive shortly'),

            timeout: 3000
          });
        } else {
          // Show success animation for immediate success
          this.claimSuccessAmount = claimedAmount;
          this.showClaimSuccess = true;
        }

        // Remove from pending list
        this.pendingBitcoinDeposits = this.pendingBitcoinDeposits.filter(
          d => d.txId !== claimedTxId
        );

        // Refresh wallet balance and transactions
        if (this.walletStore.activeWalletId) {
          await this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
        }
        await this.loadTransactions();

        // Try to find and mark the new Bitcoin transaction
        this.markRecentBitcoinClaim(claimedAmount, claimedTxId);

      } catch (error) {
        console.log('Claim in progress:', error.message);
        // Show info toast instead of error - the SDK may still complete the claim
        this.$q.notify({
          type: 'info',
          message: this.$t('Processing your deposit...'),
          caption: this.$t('This may take a few seconds'),

          timeout: 3000
        });
      } finally {
        this.isClaimingDeposit = false;
        this.claimingDeposit = null;
        this.claimFeeQuote = null;
      }
    },

    /**
     * Find and mark a recently claimed Bitcoin deposit transaction
     * Uses multiple strategies for reliable matching
     */
    markRecentBitcoinClaim(amount, depositTxId) {
      const now = Math.floor(Date.now() / 1000);
      const timeWindow = this.$options.CLAIM_MATCH_TIME_WINDOW_SECONDS || 300;

      // Strategy 1: Find transaction that references the deposit txId in description/rawType
      let matchedTx = this.transactions.find(tx =>
        tx.type === 'incoming' &&
        (now - tx.settled_at) < timeWindow &&
        (
          (tx.rawType && tx.rawType.toLowerCase().includes('deposit')) ||
          (tx.rawType && tx.rawType.toLowerCase().includes('claim')) ||
          (tx.description && tx.description.toLowerCase().includes(depositTxId?.slice(0, 8)))
        )
      );

      // Strategy 2: Find most recent incoming tx matching exact amount (no variance)
      if (!matchedTx && amount) {
        matchedTx = this.transactions.find(tx =>
          tx.type === 'incoming' &&
          tx.amount === amount &&
          (now - tx.settled_at) < timeWindow &&
          !this.getClaimedBitcoinTxIds().includes(tx.id)
        );
      }

      // Strategy 3: Find most recent incoming tx with similar amount (within 1% for fees)
      if (!matchedTx && amount) {
        const tolerance = Math.max(10, amount * 0.01);
        matchedTx = this.transactions.find(tx =>
          tx.type === 'incoming' &&
          Math.abs(tx.amount - amount) <= tolerance &&
          (now - tx.settled_at) < timeWindow &&
          !this.getClaimedBitcoinTxIds().includes(tx.id)
        );
      }

      if (matchedTx) {
        this.markAsClaimedBitcoin(matchedTx.id);
      }
    },

    cancelClaim() {
      this.showClaimDialog = false;
      this.claimingDeposit = null;
      this.claimFeeQuote = null;
    },

    onClaimSuccessClosed() {
      this.showClaimSuccess = false;
      this.claimSuccessAmount = 0;
    },

    // ==========================================
    // Refund Methods
    // ==========================================

    showRefundConfirmation() {
      // Close the claim dialog and show refund confirmation. Reset the
      // advanced disclosure so each refund starts collapsed and empty —
      // we don't want the previous attempt's address pre-filled.
      this.showClaimDialog = false;
      this.refundShowAdvanced = false;
      this.refundCustomAddress = '';
      this.showRefundDialog = true;
    },

    async confirmRefundDeposit() {
      if (!this.claimingDeposit) return;

      const customAddress = this.refundCustomAddress.trim();
      const usedCustomAddress = customAddress.length > 0;

      this.isRefundingDeposit = true;
      try {
        const provider = await this.walletStore.ensureSparkConnected();
        const result = await provider.refundDeposit({
          txId: this.claimingDeposit.txId,
          outputIndex: this.claimingDeposit.outputIndex,
          // Empty string → auto-derive sender address inside the provider.
          destinationAddress: usedCustomAddress ? customAddress : undefined
        });

        // Close dialog and reset advanced state for the next refund.
        this.showRefundDialog = false;
        this.refundShowAdvanced = false;
        this.refundCustomAddress = '';

        // Remove from pending list
        this.pendingBitcoinDeposits = this.pendingBitcoinDeposits.filter(
          d => d.txId !== this.claimingDeposit.txId
        );

        // Caption reflects what actually happened: a manual address vs.
        // the auto-derived sender. Avoids the prior UX where we always
        // claimed "sent back to the original sender" regardless.
        this.$q.notify({
          type: 'positive',
          message: this.$t('Bitcoin returned'),
          caption: usedCustomAddress
            ? this.$t('Sent to the address you provided')
            : this.$t('Sent back to the original sender'),
          icon: 'check_circle'
        });

        // Clean up state
        this.claimingDeposit = null;
        this.claimFeeQuote = null;

        // Pass txid/destination upstream in case any caller cares.
        return result;
      } catch (error) {
        console.error('Refund failed:', error);
        // The provider sometimes throws a user-actionable message
        // (e.g. "Could not determine refund destination..." after both
        // mempool sources fail) and sometimes a raw network error.
        // The unified pipeline (buildPaymentError → translateTechJargon)
        // handles both cases: prose passes through with attribution,
        // bare network errors become "Couldn't reach the network...".
        this.walletStore.showPaymentError(error, {
          context: 'l1',
          route: 'L1 refund to mempool',
          t: this.$t.bind(this),
        });
      } finally {
        this.isRefundingDeposit = false;
      }
    }
  }
}
</script>

<style scoped>
/* Base Page Styles */
/* Fixed-height flex column: the screen is laid out once and never overflows
   the safe viewport. Header + filters are fixed rows; the list (or empty
   state) is the single flex child that scrolls internally. This replaces the
   old min-height:100vh + magic vh heights which — once the Android safe-area
   insets were added — pushed the page past the viewport (body scrolled, so the
   sticky header slid over the filter tabs) and left a blank gap above the
   title. The header now owns the top inset (see .page_header_*), so the global
   .q-page top padding is cancelled here; the bottom inset clears the nav bar. */
.transaction-history-page-dark {
  background: #171717;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Manrope', sans-serif;
  max-width: 100vw;
  padding-top: 0;
  padding-bottom: var(--safe-bottom, 0px);
}

.transaction-history-page-light {
  background: #F6F6F6;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Manrope', sans-serif;
  max-width: 100vw;
  padding-top: 0;
  padding-bottom: var(--safe-bottom, 0px);
}

/* Header Styles */
/* Header owns the top safe-area inset: its background fills the area under the
   status bar and the title sits just beneath it — no blank gap above. As a
   fixed flex row at the top of the non-scrolling page column it stays put
   without position:sticky. */
.page_header_dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(0.6rem + var(--safe-top, 0px)) 1rem 0.6rem;
  background: #0C0C0C;
  border-bottom: 1px solid #2A342A;
  flex: 0 0 auto;
  z-index: 100;
}

.page_header_light {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(0.6rem + var(--safe-top, 0px)) 1rem 0.6rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
  flex: 0 0 auto;
  z-index: 100;
}

.back_btn_dark,
.close_btn_dark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease;
  color: #F6F6F6;
}

.back_btn_light,
.close_btn_light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease;
  color: var(--text-secondary);
}

.back_btn_dark:hover,
.close_btn_dark:hover {
  background: #2A342A;
}

.back_btn_light:hover,
.close_btn_light:hover {
  background: var(--bg-input);
}

.main_page_title_dark {
  color: #F6F6F6;
  font-size: 1.25rem;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
}

.main_page_title_light {
  color: #212121;
  font-size: 1.25rem;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
}

/* Filter Section */
.filter-section {
  flex: 0 0 auto;
}

.filter_section_dark {
  background: #0C0C0C;
  border-bottom: 1px solid #2A342A;
}

.filter_section_light {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
}

.filter_tabs_dark,
.filter_tabs_light {
  padding: 0 0.5rem;
}

.filter_tabs_dark :deep(.q-tabs__content),
.filter_tabs_light :deep(.q-tabs__content) {
  overflow: hidden;
}

.tab_active_dark {
  background: rgba(21, 222, 114, 0.1) !important;
  color: #15DE72 !important;
  border-radius: 999px !important;
  font-weight: 600 !important;
  font-family: 'Manrope', sans-serif !important;
}

.tab_active_light {
  /* Time-filter tabs are navigation, not semantic "positive" state.
     On cream the green-tinted wash competed with the incoming-tx
     green chevrons below it; neutralised to a cream-deep pill so
     meaning stays attached to tx state alone. */
  background: var(--bg-input) !important;
  color: var(--text-primary) !important;
  border-radius: 999px !important;
  font-weight: 600 !important;
  font-family: 'Manrope', sans-serif !important;
}

.tab_inactive_dark {
  color: #B0B0B0 !important;
  font-weight: 500 !important;
  font-family: 'Manrope', sans-serif !important;
  border-radius: 999px !important;
  border: 1px solid #2A342A;
}

.tab_inactive_light {
  color: var(--text-secondary) !important;
  font-weight: 500 !important;
  font-family: 'Manrope', sans-serif !important;
  border-radius: 999px !important;
  border: 1px solid var(--border-card);
}

/* Stats Section */
.stats_section_dark {
  background: #171717;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #2A342A;
}

.stats_section_light {
  background: var(--bg-secondary);
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-card);
}

.stats_container_dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0C0C0C;
  border: 1px solid #2A342A;
  border-radius: 12px;
  padding: 0.75rem 1rem;
}

.stats_container_light {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  padding: 0.75rem 1rem;
  box-shadow: var(--shadow-sm);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.stat_label_dark {
  font-size: 0.6875rem;
  color: #B0B0B0;
  margin-bottom: 0.25rem;
  font-weight: 400;
  text-transform: capitalize;
  letter-spacing: 0.025em;
  font-family: 'Manrope', sans-serif;
}

.stat_label_light {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
  font-weight: 400;
  text-transform: capitalize;
  letter-spacing: 0.025em;
  font-family: 'Manrope', sans-serif;
}

.stat-value {
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
  font-family: 'Manrope', sans-serif;
}

.stat-value.positive {
  color: #15DE72;
}

.stat-value.negative {
  color: #FF4B4B;
}

.stat-fiat {
  font-size: 0.75rem;
  font-weight: 400;
  margin-top: 0.125rem;
  opacity: 0.8;
}

.stat_fiat_dark {
  color: #B0B0B0;
}

.stat_fiat_light {
  color: var(--text-secondary);
}

.stat_divider_dark {
  width: 1px;
  height: 24px;
  background: #2A342A;
}

.stat_divider_light {
  width: 1px;
  height: 24px;
  background: var(--border-card);
}

/* Transaction Content */
/* The scroll viewport is sized off the full screen height minus the fixed
   header/filter chrome (~200px). On Android the page also carries the
   safe-area insets (top via the global .q-page rule, bottom via the page
   root above), so they must be subtracted here too — otherwise the list
   overflows past the safe viewport and pushes the header/tabs up under the
   status bar and the last rows down under the nav bar. On web both insets
   resolve to 0, so the math is unchanged. */
/* The list region is the single flex child that scrolls. flex:1 fills the
   space left by the header + filters; min-height:0 lets the inner QScrollArea
   actually scroll instead of forcing the column taller than the viewport. */
.transaction_content_dark {
  flex: 1 1 auto;
  min-height: 0;
  background: #171717;
}

.transaction_content_light {
  flex: 1 1 auto;
  min-height: 0;
  background: #F6F6F6;
}

/*
  QScrollArea positions its content box absolutely, which leaves the box
  shrink-to-fit: it takes the width its content asks for. What .tx-row asks
  for is its full width — a nowrap flex row reports the same min-content and
  max-content size, so min-width:0 and overflow:hidden on the title only
  govern how it divides a width it has been given, never how much it asks
  for. One long unbreakable title (a Lightning address) therefore sized the
  whole list to that title and carried the amount column off the right edge
  of the screen, with nothing to scroll it back into view. Capping the box
  at the viewport gives the rows a definite width to divide up, which is
  what the ellipsis rules below need in order to fire at all.
*/
.transaction-content :deep(.q-scrollarea__content) {
  max-width: 100%;
}

/* ==================================================================
   Transaction list — redesigned, neutral palette.
   Shares colour tokens with the Wallet page's last-tx preview so the
   two surfaces feel like one system. No green/red on amounts; no
   coloured chips on fiat. Direction is conveyed by the sign on the
   amount and the arrow direction in the left icon.
================================================================== */
.tx-groups {
  padding: 8px 16px 16px;
}

.tx-group + .tx-group {
  margin-top: 12px;
}

/* Group header: date + item count + chevron. Net amount removed to
   keep the list scannable; filter stats card carries totals when
   needed. */
.tx-group-header,
.tx-group-header-skeleton {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px 8px;
  border: none;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  -webkit-tap-highlight-color: transparent;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.tx-group-header-light {
  color: #64748b;
}

.tx-group-header-dark {
  color: #94a3b8;
}

.tx-group-date {
  flex: 0 0 auto;
}

.tx-group-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  text-transform: none;
}

.tx-group-count {
  font-size: 12px;
  opacity: 0.8;
}

.tx-group-chevron {
  opacity: 0.7;
  transition: transform 0.2s ease;
}

/* ── Rows ────────────────────────────────────────────────────── */
.tx-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tx-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid;
  background: none;
  cursor: pointer;
  text-align: left;
  transition: transform 0.12s ease, background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Manrope', sans-serif;
}

.tx-row:disabled {
  cursor: default;
}

.tx-row:not(:disabled):active {
  transform: scale(0.995);
}

.tx-row-light {
  background: #ffffff;
  border-color: #e2e8f0;
}

.tx-row-dark {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

/* Pending rows get a hairline accent on the left so scanning users
   can spot "still in motion" payments without visual shouting. */
.tx-row-pending {
  box-shadow: inset 2px 0 0 rgba(148, 163, 184, 0.5);
}

/* Ready-to-claim deposits: subtle green accent instead. Direction is
   clear from the Claim CTA too, so the accent stays quiet. */
.tx-row-ready {
  box-shadow: inset 2px 0 0 rgba(21, 222, 114, 0.6);
}

/* ── Left column (icon / avatar) ─────────────────────────────── */
.tx-row-icon-wrap {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Anchors the movement-type badge riding the avatar corner. */
  position: relative;
}

/* ── Movement-type badge ──────────────────────────────────────
   One small mark on the avatar corner: received / sent / POS /
   batch / transfer / zap. Saturated fills with a white glyph read
   identically in both themes; the ring picks up the page surface
   so the badge sits ON the avatar, not beside it. */
.tx-row-type-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 0 0 2px var(--bg-primary);
}

.tx-badge-in { background: #10B981; }
.tx-badge-out { background: #EF4444; }
.tx-badge-pos { background: #3B82F6; }
.tx-badge-aux { background: #64748B; }
.tx-badge-zap { background: #662482; }

/* The zap badge carries the Nostr ostrich head, a filled silhouette
   rather than a stroked glyph like the other five badges. Filled art
   needs more room to stay legible: below ~12px the eye and crest
   collapse into a white smudge. Sized here instead of on the <Icon>
   so the tabler glyphs keep their own tuned 10px. CSS wins over the
   width/height presentation attributes Iconify writes. */
.tx-badge-zap :deep(svg) {
  width: 12px;
  height: 12px;
}

.tx-row-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 0.02em;
}

.tx-row-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Outgoing & neutral icons: muted slate. Incoming: subtle green
   tint so direction is legible at scan time. Still muted enough to
   not compete with the balance above. */
.tx-row-icon-light {
  background: #f1f5f9;
  color: #475569;
}

.tx-row-icon-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
}

.tx-row-icon-light.tx-row-icon-in {
  background: rgba(21, 222, 114, 0.1);
  color: #059573;
}

.tx-row-icon-dark.tx-row-icon-in {
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
}

/* Bitcoin (L1) icon — overrides direction colours so L1 deposits AND
   withdrawals share the same orange brand glyph. Wins specificity over
   .tx-row-icon-in/.tx-row-icon-out by being a separate selector applied
   on top, but we use !important on color so it survives both modifier
   combinations regardless of source order. */
.tx-row-icon-bitcoin {
  color: #F7931A !important;
}
.tx-row-icon-light.tx-row-icon-bitcoin {
  background: rgba(247, 147, 26, 0.12);
}
.tx-row-icon-dark.tx-row-icon-bitcoin {
  background: rgba(247, 147, 26, 0.16);
}

/* Learn & Earn reward — the BuhoGO mark stands in for the counterparty
   avatar the row otherwise has no way to resolve. The asset is a full-bleed
   square tile carrying its own dark backdrop, so it fills the circle rather
   than sitting on one of the tinted backgrounds above. */
.tx-row-icon-earn {
  overflow: hidden;
  background: transparent;
}

.tx-row-earn-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

/* L1 badge — small pill next to the title for on-chain transactions */
.tx-row-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.tx-l1-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  line-height: 1.4;
  font-family: 'Manrope', sans-serif;
}
.tx-l1-badge-light {
  background: rgba(247, 147, 26, 0.14);
  color: #B86E0F;
}
.tx-l1-badge-dark {
  background: rgba(247, 147, 26, 0.18);
  color: #FBBF77;
}

/* ── Middle column (title + caption) ─────────────────────────── */
.tx-row-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

/*
  The title is the only part of the row allowed to give way. Without
  `min-width: 0` a nowrap text node refuses to shrink below its content,
  so a long name pushes the source chip out of the clipped title row
  instead of ellipsing itself — the chip is short, fixed, and says what
  kind of payment this was, so it holds its ground and the name yields.
*/
.tx-row-title {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
  Middle truncation, in two halves: the head gives way first, the tail
  (a domain, or the last characters of a token) holds its ground until
  there is nothing left to give. The head keeps a few characters at any
  width so the row never shows the end alone. The two spans are written
  without whitespace between them in the template — a newline there
  would render as a space in the middle of the address.
*/
.tx-row-title-split {
  display: flex;
  align-items: baseline;
  min-width: 0;
}

.tx-row-title-head {
  flex: 1 1 auto;
  min-width: 4ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-row-title-tail {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-row-title-light {
  color: #0f172a;
}

.tx-row-title-dark {
  color: #f1f5f9;
}

/*
  A message is text the counterparty wrote. It earns the top line when
  nothing else identifies them, but it must never wear the typography of
  a contact the user saved: regular weight here, quotation marks in the
  template, and the plain direction avatar beside it. Someone paying
  with the comment "Mom" then reads as a quote, not as Mom.
*/
.tx-row-title-message {
  font-weight: 400;
}

.tx-row-title-message.tx-row-title-light {
  color: #334155;
}

.tx-row-title-message.tx-row-title-dark {
  color: #cbd5e1;
}

.tx-row-sub,
.tx-row-fiat {
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tx-row-sub-icon {
  flex: 0 0 auto;
  opacity: 0.9;
}

.tx-row-sub-icon-ready {
  color: #15DE72;
  opacity: 1;
}

.tx-row-muted-light {
  color: #64748b;
}

.tx-row-muted-dark {
  color: #94a3b8;
}

/* ── Right column (amount + fiat) ────────────────────────────── */
.tx-row-amount-col {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
}

.tx-row-amount {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Incoming amounts are semantic success signals (money arrived), so
   they keep the raw green in both themes; outgoing stays neutral. */
.tx-row-amount.tx-row-amount-in {
  color: var(--color-green, #15DE72);
}

/* Sent rows carry the signed red — the reference anatomy's
   at-a-glance direction, matching the badge colors above. */
.tx-row-amount.tx-row-amount-out {
  color: #DC2626;
}

.body--dark .tx-row-amount.tx-row-amount-out {
  color: #F16A6A;
}

/* ── Confirmation dots (pending Bitcoin deposits) ────────────── */
.tx-conf-dots {
  display: inline-flex;
  gap: 3px;
  margin-right: 2px;
}

.tx-conf-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.25;
  transition: opacity 0.25s ease;
}

.tx-conf-dot-active {
  opacity: 0.9;
}

/* ── Micropayment group ──────────────────────────────────────── */
.tx-micro {
  display: flex;
  flex-direction: column;
}

.tx-micro-chevron {
  opacity: 0.6;
  margin-top: 4px;
}

.tx-micro-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0 0 44px; /* align under the text column, not the icon */
  padding: 4px 0;
  font-family: 'Manrope', sans-serif;
}

.tx-micro-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s ease;
}

.tx-micro-item:hover {
  background: rgba(148, 163, 184, 0.08);
}

.tx-micro-item-time,
.tx-micro-item-amount {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.tx-micro-item-amount {
  font-weight: 600;
}

/* ── Pending Bitcoin deposits section ────────────────────────── */
.tx-pending-deposits {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 16px 0;
}

.tx-pending-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 2px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.tx-pending-ready {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(21, 222, 114, 0.14);
  color: #15DE72;
  text-transform: none;
  letter-spacing: 0;
}

.tx-deposit-action {
  display: inline-flex;
  justify-content: flex-end;
  margin-top: 2px;
}

.tx-claim-btn {
  min-height: 28px !important;
  padding: 4px 12px !important;
  border-radius: 10px !important;
  background: #15DE72 !important;
  color: #0f172a !important;
  font-size: 12px !important;
  font-weight: 700 !important;
}

/* ── Skeleton ────────────────────────────────────────────────── */
.tx-row-skeleton {
  pointer-events: none;
}

.tx-group-header-skeleton {
  pointer-events: none;
}

/* ── Legacy transaction-item block kept for code paths we haven't
   migrated; safe to remove once confirmed unused. ──────────── */
.transaction_item_dark {
  display: flex;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #2A342A;
}

.transaction_item_light {
  display: flex;
  align-items: center;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #F3F4F6;
}

.transaction_item_dark:hover {
  background: #171717;
}

.transaction_item_light:hover {
  background: #F9FAFB;
}

.transaction_item_dark:last-child,
.transaction_item_light:last-child {
  border-bottom: none;
}

.transaction-icon {
  margin-right: 1rem;
}

.tx-icon-container {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.tx-icon-received {
  background: linear-gradient(135deg, #15DE72, #059573);
}

.tx-icon-sent {
  background: linear-gradient(135deg, #6B7280, #4B5563);
}

.tx-icon-zap {
  background: linear-gradient(135deg, #15DE72, #43B65B);
}

.tx-icon-bitcoin {
  background: linear-gradient(135deg, #F7931A, #D97706);
}

.transaction-details {
  flex: 1;
  min-width: 0;
}

.transaction-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.transaction_type_dark {
  font-weight: 500;
  color: #F6F6F6;
  font-size: 0.95rem;
  font-family: 'Manrope', sans-serif;
}

.transaction_type_light {
  font-weight: 500;
  color: #212121;
  font-size: 0.95rem;
  font-family: 'Manrope', sans-serif;
}

.transaction_time_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  font-family: 'Manrope', sans-serif;
}

.transaction_time_light {
  color: #6B7280;
  font-size: 0.8rem;
  font-family: 'Manrope', sans-serif;
}

.transaction_description_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
  display: block;
  font-family: 'Manrope', sans-serif;
}

.transaction_description_light {
  color: #6B7280;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
  display: block;
  font-family: 'Manrope', sans-serif;
}

.nostr_info_dark {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #15DE72;
  font-size: 0.7rem;
  font-weight: 500;
  font-family: 'Manrope', sans-serif;
}

.nostr_info_light {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #059573;
  font-size: 0.7rem;
  font-weight: 500;
  font-family: 'Manrope', sans-serif;
}

.sender-avatar {
  border: 1px solid rgba(21, 222, 114, 0.3);
}

.sender-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}

.transaction-amount {
  text-align: right;
  /*min-width: 90px;*/
}

.amount_sats_dark {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
  font-family: 'Manrope', sans-serif;
}

.amount_sats_light {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
  font-family: 'Manrope', sans-serif;
}

.amount-positive {
  color: #15DE72;
}

.amount-negative {
  color: #FF4B4B;
}

.amount-pending {
  color: #F59E0B;
  opacity: 0.7;
}

.amount_fiat_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  font-family: 'Manrope', sans-serif;
}

.amount_fiat_light {
  color: #6B7280;
  font-size: 0.8rem;
  font-family: 'Manrope', sans-serif;
}

/* Loading and Empty States */
.loading_state_dark,
.empty_state_dark {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  text-align: center;
  padding: 2rem;
  background: #0C0C0C;
}

.loading_state_light,
.empty_state_light {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  text-align: center;
  padding: 2rem;
  background: var(--bg-primary);
}

.loading_text_dark {
  margin-top: 1rem;
  color: #B0B0B0;
  font-size: 1rem;
  font-family: 'Manrope', sans-serif;
}

.loading_text_light {
  margin-top: 1rem;
  color: #6B7280;
  font-size: 1rem;
  font-family: 'Manrope', sans-serif;
}

.empty-illustration-img {
  width: 100%;
  max-width: 180px;
  height: auto;
  margin-bottom: 1.25rem;
  user-select: none;
  pointer-events: none;
}

.empty_title_dark {
  font-size: 1.25rem;
  font-weight: 600;
  color: #F6F6F6;
  margin-bottom: 0.5rem;
  font-family: 'Manrope', sans-serif;
}

.empty_title_light {
  font-size: 1.25rem;
  font-weight: 600;
  color: #212121;
  margin-bottom: 0.5rem;
  font-family: 'Manrope', sans-serif;
}

.empty_subtitle_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  font-family: 'Manrope', sans-serif;
}

.empty_subtitle_light {
  color: #6B7280;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  font-family: 'Manrope', sans-serif;
}

/* Secondary Buttons */
.btn_dark {
  border-radius: 20px !important;
  border: 1px solid #2A382A !important;
  background: rgba(255, 255, 255, 0.05) !important;
  color: #FFF !important;
  font-family: 'Manrope', sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

.btn_light {
  border-radius: 20px !important;
  border: 1px solid var(--border-card) !important;
  background: var(--bg-input) !important;
  color: var(--text-primary) !important;
  font-family: 'Manrope', sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

/* Load More Section */
.load-more-section {
  display: flex;
  justify-content: center;
  padding: 16px 16px 32px;
}

.load-more-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 24px;
  border-radius: 20px;
}

.load-more-dark {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.08);
}

.load-more-dark:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.load-more-light {
  color: rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
}

.load-more-light:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #000;
}

/* End of List Indicator */
.end-of-list {
  display: flex;
  justify-content: center;
  padding: 16px 16px 32px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
}

/* ==========================================
   Pending Bitcoin Deposits - TX List Style
   ========================================== */
/* (Legacy pending-deposits styles removed; see .tx-pending-* above.) */

/* ==========================================
   iOS Action Sheet - Claim Confirmation
   ========================================== */
.claim-action-sheet {
  width: 100%;
  max-width: 100%;
  border-radius: 20px 20px 0 0;
  margin: 0;
}

.claim-action-sheet.sheet-dark {
  background: #1C1C1E;
}

.claim-action-sheet.sheet-light {
  background: var(--bg-card);
}

/* Handle Bar */
.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 12px 0 8px;
}

.handle-bar {
  width: 36px;
  height: 5px;
  background: rgba(128, 128, 128, 0.3);
  border-radius: 3px;
}

/* Amount Display */
.claim-amount-display {
  text-align: center;
  padding: 16px 24px 24px;
}

.claim-amount-value {
  font-size: 42px;
  font-weight: 700;
  font-family: 'Manrope', sans-serif;
  letter-spacing: -1px;
  color: #34C759;
  line-height: 1.1;
}

.claim-amount-label {
  font-size: 15px;
  margin-top: 8px;
  font-family: 'Manrope', sans-serif;
}

/* Fee Summary */
.claim-fee-summary {
  margin: 0 20px 16px;
  padding: 14px 16px;
  border-radius: 12px;
}

.claim-fee-summary.summary-dark {
  background: rgba(255, 255, 255, 0.06);
}

.claim-fee-summary.summary-light {
  background: rgba(0, 0, 0, 0.03);
}

.fee-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-family: 'Manrope', sans-serif;
}

.fee-line .fee-label {
  font-size: 14px;
  opacity: 0.7;
}

.fee-line .fee-value {
  font-size: 14px;
  font-weight: 500;
}

.fee-line.deduction .fee-value {
  color: #FF6B6B;
}

/* High Fee Notice */
.high-fee-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 20px 16px;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(255, 107, 107, 0.1);
  color: #FF6B6B;
  font-size: 13px;
  font-weight: 500;
  font-family: 'Manrope', sans-serif;
}

/* Action Buttons */
.claim-sheet-actions {
  padding: 8px 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.claim-confirm-btn {
  width: 100%;
  height: 54px;
  border-radius: 14px;
  font-size: 17px;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
  background: #34C759 !important;
  color: white !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.claim-confirm-btn:hover {
  background: #2DB84D !important;
}

.claim-cancel-btn {
  width: 100%;
  height: 50px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 500;
  font-family: 'Manrope', sans-serif;
}

.claim-cancel-btn.cancel-dark {
  color: rgba(255, 255, 255, 0.6);
}

.claim-cancel-btn.cancel-light {
  color: rgba(0, 0, 0, 0.5);
}

/* Refund Option Link */
.refund-option {
  text-align: center;
  padding: 0 20px 20px;
}

.refund-link {
  font-size: 13px;
  font-family: 'Manrope', sans-serif;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.refund-link.refund-dark {
  color: rgba(255, 255, 255, 0.4);
}

.refund-link.refund-light {
  color: rgba(0, 0, 0, 0.4);
}

/* Refund Confirmation Dialog */
.refund-dialog {
  width: 320px;
  max-width: 90vw;
  border-radius: 20px;
}

.refund-dialog.dialog-dark {
  background: #1C1C1E;
}

.refund-dialog.dialog-light {
  background: var(--bg-card);
}

.refund-header {
  text-align: center;
  padding: 28px 24px 16px;
}

.refund-icon {
  color: #F7931A;
  margin-bottom: 12px;
}

.refund-title {
  font-size: 20px;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
}

.refund-body {
  padding: 0 24px 16px;
  text-align: center;
}

.refund-body p {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.5;
  font-family: 'Manrope', sans-serif;
}

.refund-amount-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: 12px;
  margin-top: 16px;
}

.refund-amount-box.box-dark {
  background: rgba(255, 255, 255, 0.06);
}

.refund-amount-box.box-light {
  background: rgba(0, 0, 0, 0.04);
}

.refund-amount-label {
  font-size: 13px;
  opacity: 0.7;
  font-family: 'Manrope', sans-serif;
}

.refund-amount-value {
  font-size: 15px;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
}

/* ── Advanced disclosure — manual destination override ── */
.refund-advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 6px 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.refund-advanced-toggle.toggle-light { color: rgba(0, 0, 0, 0.6); }
.refund-advanced-toggle.toggle-dark { color: rgba(255, 255, 255, 0.7); }
.refund-advanced-toggle:hover { opacity: 0.85; }

.refund-advanced-chev {
  transition: transform 0.18s ease;
}
.refund-advanced-chev.flipped { transform: rotate(180deg); }

.refund-advanced-panel {
  margin-top: 8px;
  padding: 12px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.refund-advanced-panel.panel-light { background: rgba(0, 0, 0, 0.04); }
.refund-advanced-panel.panel-dark { background: rgba(255, 255, 255, 0.05); }

.refund-advanced-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.75;
}

.refund-advanced-input {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}
.refund-advanced-input.input-light {
  background: #fff;
  color: #111;
  border-color: rgba(0, 0, 0, 0.12);
}
.refund-advanced-input.input-light:focus { border-color: rgba(0, 0, 0, 0.4); }
.refund-advanced-input.input-dark {
  background: rgba(0, 0, 0, 0.32);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.12);
}
.refund-advanced-input.input-dark:focus { border-color: rgba(255, 255, 255, 0.45); }

.refund-advanced-hint {
  margin: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  opacity: 0.6;
}

.refund-advanced-fade-enter-active,
.refund-advanced-fade-leave-active {
  transition: opacity 0.18s ease, max-height 0.2s ease;
  overflow: hidden;
}
.refund-advanced-fade-enter-from,
.refund-advanced-fade-leave-to {
  opacity: 0;
  max-height: 0;
}
.refund-advanced-fade-enter-to,
.refund-advanced-fade-leave-from {
  opacity: 1;
  max-height: 200px;
}

.refund-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 20px 24px;
}

.refund-keep-btn {
  width: 100%;
  height: 50px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 600;
  font-family: 'Manrope', sans-serif;
  background: #34C759 !important;
  color: white !important;
}

.refund-confirm-btn {
  width: 100%;
  height: 50px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 500;
  font-family: 'Manrope', sans-serif;
  background: #8E8E93 !important;
  color: white !important;
}

/* Mobile Responsive */
@media (max-width: 375px) {
  .claim-amount-value {
    font-size: 36px;
  }

  .claim-amount-label {
    font-size: 14px;
  }

  .claim-confirm-btn {
    height: 50px;
    font-size: 16px;
  }

  .claim-cancel-btn {
    height: 46px;
    font-size: 15px;
  }
}

/* Responsive Design */
@media (max-width: 480px) {
  .transaction_description_dark,
  .transaction_description_light {
    max-width: 150px;
    font-size: 0.75rem;
  }

  .transaction-details {
    max-width: calc(100% - 140px);
  }

  .transaction-amount {
    min-width: 100px;
    flex-shrink: 0;
  }

  .stats_section_dark,
  .stats_section_light {
    padding: 0.75rem;
  }

  .stats_container_dark,
  .stats_container_light {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
  }

  .stat_label_dark,
  .stat_label_light {
    font-size: 0.625rem;
    margin-bottom: 0.125rem;
  }

  .stat-value {
    font-size: 0.8125rem;
  }

  .transaction_item_dark,
  .transaction_item_light {
    padding: 0.75rem;
  }

  .transaction-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .group_header_dark,
  .group_header_light {
    padding: 0.75rem;
  }

  .tx-icon-container {
    width: 32px;
    height: 32px;
  }
}

/* ── Filter summary cards (Net / Received / Sent) ─────────────
   Three equal neutral cards shown when a filter other than "all"
   is active. Shares the .tx-row surface/border for a consistent
   language down the page. Each card carries its own fiat line so
   the Net / Received / Sent triple is self-describing. */
.stats-section {
  padding: 12px 16px 4px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.stats-card {
  padding: 14px 14px 12px;
  border-radius: 16px;
  border: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: 'Manrope', sans-serif;
  min-width: 0;
  transition: border-color 0.15s ease, transform 0.12s ease;
}

.stats-card-light {
  background: #ffffff;
  border-color: #e2e8f0;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}

.stats-card-dark {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

.stats-card-head {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 2px;
  min-width: 0;
}

.stats-card-head-icon {
  flex: 0 0 auto;
  opacity: 0.85;
}

/* Subtle green accent on the Received card's direction icon only,
   staying within the neutral palette rule (no colour on the value
   itself). Just enough to help users scan the triple at a glance. */
.stats-card-head-icon-in {
  color: #15DE72;
  opacity: 0.95;
}

.stats-card-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats-card-value {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.stats-card-fiat {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: auto;
}

/* On small screens the value can get tight at 3-up. Drop the
   value one notch and tighten padding so it still reads. */
@media (max-width: 380px) {
  .stats-grid {
    gap: 8px;
  }
  .stats-card {
    padding: 12px 12px 10px;
  }
  .stats-card-value {
    font-size: 14px;
  }
  .stats-card-fiat {
    font-size: 10.5px;
  }
}
</style>
