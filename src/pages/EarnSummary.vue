<template>
  <q-page class="earn-summary-page" :class="$q.dark.isActive ? 'earn-dark' : 'earn-light'">

    <!-- Header -->
    <div class="summary-header">
      <div aria-hidden="true" />
      <div class="summary-header-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
        {{ $t('Summary') }}
      </div>
      <q-btn flat round dense class="payout-wallet-btn" @click="showPayoutWalletPicker = true">
        <Icon icon="tabler:wallet" width="20" height="20" />
        <q-tooltip>{{ $t('Change payout wallet') }}</q-tooltip>
      </q-btn>
    </div>

    <q-dialog v-model="showPayoutWalletPicker" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="payout-wallet-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="payout-wallet-heading">
          <img src="/Learn and Earn/Question_pictures/money-income.svg" class="payout-wallet-illustration" alt="" aria-hidden="true" />
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Where should your rewards go?') }}
          </div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-list>
            <q-item
              v-for="wallet in payoutWallets"
              :key="wallet.id"
              clickable
              v-ripple
              class="wallet-pick-item"
              @click="selectPayoutWallet(wallet.id)"
            >
              <q-item-section avatar>
                <Icon icon="tabler:wallet" width="20" height="20" />
              </q-item-section>
              <q-item-section>
                <q-item-label :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                  {{ wallet.name }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <Icon v-if="selectedPayoutWallet?.id === wallet.id" icon="tabler:circle-check" width="20" height="20" style="color: #92E3A9;" />
              </q-item-section>
            </q-item>
            <q-item v-if="!payoutWallets.length" class="wallet-picker-empty">
              <q-item-section>
                {{ $t('Add a Spark, LNbits, or NWC wallet to receive Learn & Earn rewards.') }}
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Hero illustration -->
    <div class="summary-hero">
      <img src="/Learn and Earn/Question_pictures/convertible car-bro.svg" class="summary-hero-img" alt="" />
    </div>

    <!-- Stats cards -->
    <div class="summary-stats">
      <div class="stat-card" :class="$q.dark.isActive ? 'stat-dark' : 'stat-light'">
        <div class="stat-icon-wrap stat-icon-sats">
          <Icon icon="tabler:bolt" width="22" height="22" />
        </div>
        <div class="stat-info">
          <div class="stat-value" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ earnStore.totalEarned }}
          </div>
          <div class="stat-label">{{ $t('sats earned') }}</div>
        </div>
      </div>

      <div class="stat-card" :class="$q.dark.isActive ? 'stat-dark' : 'stat-light'">
        <div class="stat-icon-wrap stat-icon-progress">
          <Icon icon="tabler:target-arrow" width="22" height="22" />
        </div>
        <div class="stat-info">
          <div class="stat-value" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ earnStore.overallProgress }}%
          </div>
          <div class="stat-label">{{ $t('completed') }}</div>
        </div>
      </div>
    </div>

    <!-- Payout section -->
    <div class="summary-section">
      <div class="summary-section-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
        {{ earnStore.canClaim ? $t('Claim Your Sats') : $t('Next Payout') }}
        <q-btn flat round dense size="sm" class="info-icon" @click="showPayoutInfo = true">
          <Icon icon="tabler:info-circle" width="16" height="16" />
        </q-btn>
      </div>

      <!-- Payout info dialog -->
      <q-dialog v-model="showPayoutInfo" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
        <q-card class="info-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
          <q-card-section>
            <div class="info-card-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
              {{ $t('How Payouts Work') }}
            </div>
          </q-card-section>
          <q-card-section class="q-pt-none">
            <div class="info-item">
              <div class="info-item-icon"><Icon icon="tabler:bolt" width="18" height="18" /></div>
              <div class="info-item-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Every correct answer earns you 1 sat') }}
              </div>
            </div>
            <div class="info-item">
              <div class="info-item-icon"><Icon icon="tabler:coin" width="18" height="18" /></div>
              <div class="info-item-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('You can claim once you reach 25 sats') }}
              </div>
            </div>
            <div class="info-item">
              <div class="info-item-icon"><Icon icon="tabler:gift" width="18" height="18" /></div>
              <div class="info-item-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
                {{ $t('Complete all lessons and get your earnings doubled!') }}
              </div>
            </div>
          </q-card-section>
          <q-card-actions align="center" class="q-pb-md">
            <q-btn flat no-caps :label="$t('Got it')" v-close-popup style="color: var(--color-green, #15DE72);" />
          </q-card-actions>
        </q-card>
      </q-dialog>
      <div class="payout-progress-card" :class="$q.dark.isActive ? 'stat-dark' : 'stat-light'">
        <div class="payout-progress-info">
          <span class="payout-progress-value" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ earnStore.pendingSats }} {{ $t('sats') }}
          </span>
          <span v-if="!earnStore.canClaim" class="payout-progress-hint">
            {{ earnStore.payoutThreshold - earnStore.pendingSats }} {{ $t('more to go') }}
          </span>
          <span v-else class="payout-progress-hint payout-ready">
            {{ earnStore.claimableAmount }} {{ $t('sats ready to claim') }}
          </span>
        </div>
        <div class="payout-bar">
          <div class="payout-bar-fill" :style="{ width: Math.min(earnStore.pendingSats / earnStore.payoutThreshold * 100, 100) + '%' }" />
        </div>
        <q-btn
          v-if="earnStore.canClaim"
          unelevated no-caps
          :label="earnStore.isOnCooldown
            ? $t('Wait {mins} min', { mins: Math.ceil(earnStore.claimCooldownRemaining / 60000) })
            : $t('Claim {amount} sats', { amount: earnStore.claimableAmount })"
          class="claim-btn"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :loading="isClaiming"
          :disable="earnStore.isOnCooldown || !selectedPayoutWallet"
          @click="claimSats"
        />
        <div v-if="earnStore.canClaim && !selectedPayoutWallet" class="payout-wallet-hint" :class="$q.dark.isActive ? 'payout-wallet-hint-dark' : 'payout-wallet-hint-light'">
          {{ $t('Choose a payout wallet to claim your sats.') }}
        </div>
      </div>
    </div>

    <!-- Progress overview -->
    <div class="summary-section">
      <div class="summary-section-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
        {{ $t('Your Progress') }}
      </div>

      <div class="summary-progress-list">
        <div
          v-for="group in earnStore.groups"
          :key="group.id"
          class="progress-row"
          :class="$q.dark.isActive ? 'row-dark' : 'row-light'"
        >
          <img :src="group.illustration" class="progress-row-icon" alt="" />
          <div class="progress-row-info">
            <div class="progress-row-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
              {{ group.title }}
            </div>
            <div class="progress-row-bar">
              <div class="progress-row-fill" :style="{ width: getGroupProgress(group.id).percentage + '%' }" />
            </div>
          </div>
          <div class="progress-row-count">
            {{ getGroupProgress(group.id).completed }}/{{ getGroupProgress(group.id).total }}
          </div>
        </div>
      </div>
    </div>

    <!-- Completion bonus -->
    <div v-if="earnStore.allCompleted && !earnStore.bonusPaid" class="summary-section">
      <div class="bonus-card" :class="$q.dark.isActive ? 'stat-dark' : 'stat-light'">
        <Icon icon="tabler:gift" width="28" height="28" style="color: #92E3A9;" />
        <div class="bonus-text" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
          {{ $t('All lessons done! Double your earnings now.') }}
        </div>
        <q-btn
          unelevated no-caps
          :label="$t('Double My Sats')"
          class="bonus-btn"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="claimBonus"
        />
      </div>
    </div>

    <div v-if="earnStore.bonusPaid" class="summary-section">
      <div class="bonus-card" :class="$q.dark.isActive ? 'stat-dark' : 'stat-light'">
        <Icon icon="tabler:confetti" width="28" height="28" style="color: #92E3A9;" />
        <div class="bonus-text" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
          {{ $t('Bonus claimed! You earned double sats.') }}
        </div>
      </div>
    </div>

    <!-- Bottom spacer for nav bar -->
    <div style="height: 100px;" />

    <!-- Bottom Nav -->
    <EarnBottomNav active-tab="summary" />
  </q-page>
</template>

<script>
import { useEarnStore } from '../stores/earn'
import { useWalletStore } from '../stores/wallet'
import { findEarnPayoutWallet, getEarnPayoutWallets } from '../utils/earnWallets'
import EarnBottomNav from '../components/EarnBottomNav.vue'

export default {
  name: 'EarnSummary',
  components: { EarnBottomNav },
  setup() {
    const earnStore = useEarnStore()
    const walletStore = useWalletStore()
    return { earnStore, walletStore }
  },
  data() {
    return {
      isClaiming: false,
      showPayoutInfo: false,
      showPayoutWalletPicker: false,
    }
  },
  computed: {
    payoutWallets() {
      return getEarnPayoutWallets(this.walletStore.wallets)
    },
    selectedPayoutWallet() {
      return findEarnPayoutWallet(this.walletStore.wallets, this.earnStore.selectedWalletId)
    },
  },
  async created() {
    await this.earnStore.initialize()
  },
  methods: {
    getGroupProgress(groupId) {
      return this.earnStore.groupProgress(groupId)
    },

    selectPayoutWallet(walletId) {
      if (!this.payoutWallets.some((wallet) => wallet.id === walletId)) return
      this.earnStore.setSelectedWallet(walletId)
      this.showPayoutWalletPicker = false
    },

    async claimSats() {
      this.isClaiming = true
      try {
        const result = await this.earnStore.claimPayout()
        if (result.success) {
          this.$q.notify({
            type: 'positive',
            message: this.$t('{amount} sats claimed!', { amount: result.amount }),
          })
        } else if (result.error === 'cooldown') {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Please wait {mins} minutes before claiming again', { mins: result.minutesLeft }),
          })
        } else if (result.error === 'daily_budget' || result.error === 'ip_cap') {
          this.$q.notify({
            type: 'warning',
            message: this.$t('The daily reward budget is used up. Please try again tomorrow.'),
          })
        } else if (result.error === 'lifetime_cap') {
          this.$q.notify({
            type: 'warning',
            message: this.$t('You have already received the maximum reward.'),
          })
        } else {
          // No exception was raised; the store returned a structured failure.
          // Prefer the original coded error when available, otherwise provide
          // a concise local fallback without attributing it to the payout API.
          this.walletStore.showPaymentError(result.cause || new Error(`claim failed: ${result.error || 'unknown'}`), {
            context: 'earn',
            route: 'Earn payout claim',
            reason: result.cause ? undefined : this.$t('Claim failed. Try again later.'),
            t: this.$t.bind(this),
          })
        }
      } catch (e) {
        this.walletStore.showPaymentError(e, {
          context: 'earn',
          route: 'Earn payout claim',
          t: this.$t.bind(this),
        })
      } finally {
        this.isClaiming = false
      }
    },

    async claimBonus() {
      this.isClaiming = true
      try {
        const result = await this.earnStore.executeCompletionBonus()
        if (result.success) {
          this.$q.notify({
            type: 'positive',
            message: this.$t('Bonus claimed! {amount} sats earned', { amount: result.totalPayout }),
          })
        } else if (result.error === 'cooldown') {
          // The bonus is cooldown-exempt on both sides, so this only fires if
          // the app is running against a payout service that predates that
          // rule. Kept so the skew window explains itself instead of falling
          // through to the generic failure dialog.
          this.$q.notify({
            type: 'warning',
            message: this.$t('Please wait {mins} minutes before claiming again', { mins: result.minutesLeft }),
          })
        } else if (result.error === 'daily_budget' || result.error === 'ip_cap') {
          this.$q.notify({
            type: 'warning',
            message: this.$t('The daily reward budget is used up. Please try again tomorrow.'),
          })
        } else if (result.error === 'lifetime_cap') {
          this.$q.notify({
            type: 'warning',
            message: this.$t('You have already received the maximum reward.'),
          })
        } else {
          this.walletStore.showPaymentError(result.cause || new Error(`bonus claim failed: ${result.error || 'unknown'}`), {
            context: 'earn',
            route: 'Earn completion bonus',
            reason: result.cause ? undefined : this.$t('Claim failed. Try again later.'),
            t: this.$t.bind(this),
          })
        }
      } catch (e) {
        this.walletStore.showPaymentError(e, {
          context: 'earn',
          route: 'Earn completion bonus',
          t: this.$t.bind(this),
        })
      } finally {
        this.isClaiming = false
      }
    },
  }
}
</script>

<style scoped>
.earn-summary-page {
  min-height: 100vh;
}

.earn-dark {
  background: var(--bg-primary);
  background-image: radial-gradient(ellipse 500px 400px at 50% 20%, rgba(146, 227, 169, 0.03), transparent);
}
.earn-light {
  background: var(--bg-primary);
  background-image: radial-gradient(ellipse 500px 400px at 50% 20%, rgba(146, 227, 169, 0.06), transparent);
}

/* Header */
.summary-header {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  padding: 16px 20px;
  padding-top: calc(var(--safe-top, 0px) + 16px);
}

.summary-header-title {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 800;
  text-align: center;
}

/* Hero */
.summary-hero {
  display: flex;
  justify-content: center;
  padding: 0 20px 20px;
}

.summary-hero-img {
  width: 300px;
  height: 230px;
  object-fit: contain;
}

/* Stats */
.summary-stats {
  display: flex;
  gap: 12px;
  padding: 0 20px 20px;
}

.stat-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 16px;
}

.stat-dark {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.stat-light {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.stat-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-icon-sats {
  background: rgba(146, 227, 169, 0.15);
  color: #92E3A9;
}

.stat-icon-progress {
  background: rgba(99, 102, 241, 0.15);
  color: #818cf8;
}

.stat-info { min-width: 0; }

.stat-value {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 800;
}

.stat-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Sections */
.summary-section {
  padding: 0 20px 20px;
}

.summary-section-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
}

/* Progress list */
.summary-progress-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
}

.row-dark {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.row-light {
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.progress-row-icon {
  width: 36px;
  height: 36px;
  object-fit: contain;
  flex-shrink: 0;
}

.progress-row-info {
  flex: 1;
  min-width: 0;
}

.progress-row-title {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.progress-row-bar {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.earn-light .progress-row-bar { background: rgba(0, 0, 0, 0.06); }

.progress-row-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #059573, #92E3A9);
  transition: width 0.4s ease;
}

.progress-row-count {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Payout progress */
.payout-progress-card {
  padding: 16px;
  border-radius: 16px;
}

.payout-progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.payout-progress-value {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
}

.payout-progress-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.payout-bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.earn-light .payout-bar { background: rgba(0, 0, 0, 0.06); }

.payout-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #059573, #92E3A9);
  transition: width 0.4s ease;
}

/* Bonus */
.bonus-card {
  padding: 20px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.bonus-text {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.bonus-btn {
  padding: 12px 32px;
  border-radius: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
}

/* Claim button */
.claim-btn {
  width: 100%;
  padding: 14px;
  border-radius: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  margin-top: 14px;
}

.payout-wallet-hint {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
}

.payout-wallet-hint-light {
  background: rgba(5, 149, 115, 0.08);
  color: #065f46;
}

.payout-wallet-hint-dark {
  background: rgba(146, 227, 169, 0.12);
  color: #c8f7d4;
}

.payout-ready {
  color: var(--color-green, #15DE72);
  font-weight: 600;
}

/* Info icon */
.info-icon {
  color: var(--text-muted);
  margin-left: 4px;
  vertical-align: middle;
}

.payout-wallet-btn {
  justify-self: end;
  color: var(--text-muted);
}

.payout-wallet-card {
  width: min(340px, calc(100vw - 32px));
  border-radius: 16px !important;
}

.payout-wallet-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.payout-wallet-illustration {
  width: 72px;
  height: 72px;
  object-fit: contain;
  flex: 0 0 auto;
}

.wallet-pick-item {
  border-radius: 8px;
}

.wallet-picker-empty {
  min-height: 76px;
  color: var(--text-muted);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.45;
  text-align: center;
}

/* Info dialog */
.info-card {
  border-radius: 20px !important;
  max-width: 340px;
}

.info-card-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
}

.info-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
}

.info-item-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(146, 227, 169, 0.12);
  color: #92E3A9;
}

.info-item-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  padding-top: 4px;
}
</style>
