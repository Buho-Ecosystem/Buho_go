<template>
  <q-page class="learn-page" :class="$q.dark.isActive ? 'learn-dark' : 'learn-light'">
    <!-- Header -->
    <div class="learn-header">
      <q-btn flat round dense @click="$router.back()" class="learn-back">
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="learn-header-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
        {{ $t('Learn & Earn') }}
      </div>
      <div style="width: 40px;" />
    </div>

    <!-- Hero -->
    <div class="learn-hero">
      <img src="/Learn and Earn/education.svg" class="learn-hero-img" alt="" />
      <div class="learn-hero-stats">
        <div class="learn-stat">
          <div class="learn-stat-value" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ earnStore.totalEarned }}
          </div>
          <div class="learn-stat-label">{{ $t('sats earned') }}</div>
        </div>
        <div class="learn-stat-divider" />
        <div class="learn-stat">
          <div class="learn-stat-value" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ earnStore.totalCompleted }}/{{ earnStore.totalQuestions }}
          </div>
          <div class="learn-stat-label">{{ $t('questions') }}</div>
        </div>
      </div>
    </div>

    <!-- Group Cards -->
    <div class="learn-groups">
      <div
        v-for="(group, index) in earnStore.groups"
        :key="group.id"
        class="learn-group-card"
        :class="[
          $q.dark.isActive ? 'card-dark' : 'card-light',
          { 'learn-group-locked': !earnStore.isGroupUnlocked(group.id) }
        ]"
        @click="openGroup(group)"
      >
        <div class="learn-group-top">
          <img :src="group.illustration" class="learn-group-icon" alt="" />
          <div class="learn-group-info">
            <div class="learn-group-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
              {{ group.title }}
            </div>
            <div class="learn-group-meta" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ group.chapters.length }} {{ group.chapters.length === 1 ? $t('chapter') : $t('chapters') }}
            </div>
          </div>
          <div v-if="!earnStore.isGroupUnlocked(group.id)" class="learn-lock">
            <Icon icon="tabler:lock" width="18" height="18" />
          </div>
          <div v-else-if="getGroupProgress(group.id).percentage === 100" class="learn-check">
            <Icon icon="tabler:circle-check-filled" width="20" height="20" />
          </div>
          <Icon v-else icon="tabler:chevron-right" width="18" height="18" class="learn-chevron" />
        </div>

        <!-- Progress bar -->
        <div class="learn-progress-bar">
          <div
            class="learn-progress-fill"
            :style="{ width: getGroupProgress(group.id).percentage + '%' }"
          />
        </div>
        <div class="learn-progress-text" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
          <template v-if="!earnStore.isGroupUnlocked(group.id)">
            {{ $t('Complete previous group to unlock') }}
          </template>
          <template v-else>
            {{ getGroupProgress(group.id).completed }}/{{ getGroupProgress(group.id).total }}
            {{ $t('completed') }}
          </template>
        </div>
      </div>
    </div>

    <!-- Wallet Selection Dialog -->
    <q-dialog v-model="showWalletPicker" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="wallet-picker-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section>
          <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Where should your rewards go?') }}
          </div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-list>
            <q-item
              v-for="wallet in walletStore.wallets"
              :key="wallet.id"
              clickable
              v-ripple
              @click="selectWallet(wallet.id)"
              class="wallet-pick-item"
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
                <Icon v-if="earnStore.selectedWalletId === wallet.id" icon="tabler:circle-check" width="20" height="20" style="color: #15DE72;" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { useEarnStore } from '../stores/earn'
import { useWalletStore } from '../stores/wallet'

export default {
  name: 'LearnDashboard',
  setup() {
    const earnStore = useEarnStore()
    const walletStore = useWalletStore()
    return { earnStore, walletStore }
  },
  data() {
    return {
      showWalletPicker: false,
      pendingGroupId: null,
    }
  },
  async created() {
    await this.earnStore.initialize()
  },
  methods: {
    getGroupProgress(groupId) {
      return this.earnStore.groupProgress(groupId)
    },

    openGroup(group) {
      if (!this.earnStore.isGroupUnlocked(group.id)) {
        this.$q.notify({
          type: 'info',
          message: this.$t('Complete the previous group first'),
        })
        return
      }

      // If no wallet selected yet, ask first
      if (!this.earnStore.selectedWalletId) {
        this.pendingGroupId = group.id
        this.showWalletPicker = true
        return
      }

      this.$router.push(`/learn/${group.id}`)
    },

    selectWallet(walletId) {
      this.earnStore.setSelectedWallet(walletId)
      this.showWalletPicker = false

      if (this.pendingGroupId) {
        this.$router.push(`/learn/${this.pendingGroupId}`)
        this.pendingGroupId = null
      }
    },
  }
}
</script>

<style scoped>
.learn-page {
  min-height: 100vh;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
}

.learn-dark { background: var(--bg-primary); }
.learn-light { background: #F8F8F8; }

/* Header */
.learn-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: calc(var(--safe-top, 0px) + 12px);
}

.learn-back { color: var(--text-secondary); }

.learn-header-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
}

/* Hero */
.learn-hero {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.learn-hero-img {
  width: 200px;
  height: 150px;
  object-fit: contain;
  margin-bottom: 20px;
}

.learn-hero-stats {
  display: flex;
  align-items: center;
  gap: 24px;
}

.learn-stat {
  text-align: center;
}

.learn-stat-value {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 800;
}

.learn-stat-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 2px;
}

.learn-stat-divider {
  width: 1px;
  height: 28px;
  background: var(--border-card);
}

/* Group Cards */
.learn-groups {
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.learn-group-card {
  border-radius: 16px;
  padding: 16px;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
  border: 1px solid var(--border-card);
}

.learn-group-card:active {
  transform: scale(0.98);
}

.learn-group-locked {
  opacity: 0.5;
}

.learn-group-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.learn-group-icon {
  width: 56px;
  height: 56px;
  object-fit: contain;
  flex-shrink: 0;
}

.learn-group-info {
  flex: 1;
  min-width: 0;
}

.learn-group-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
}

.learn-group-meta {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 400;
  margin-top: 2px;
}

.learn-lock { color: var(--text-muted); }
.learn-check { color: #15DE72; }
.learn-chevron { color: var(--text-muted); }

/* Progress */
.learn-progress-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-input);
  overflow: hidden;
}

.learn-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #059573, #15DE72);
  transition: width 0.4s ease;
}

.learn-progress-text {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 500;
  margin-top: 6px;
}

/* Card themes */
.card-dark { background: var(--bg-card); }
.card-light { background: #FFF; }

/* Wallet picker */
.wallet-picker-card { min-width: 300px; border-radius: 20px !important; }
.wallet-pick-item { border-radius: 12px; }
</style>
