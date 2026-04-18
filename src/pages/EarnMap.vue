<template>
  <q-page class="earn-map-page" :class="$q.dark.isActive ? 'earn-dark' : 'earn-light'">

    <!-- Sticky Header -->
    <div class="earn-map-header">
      <q-btn flat round dense @click="$router.back()" class="earn-back">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="earn-sats-pill" @click="$router.push('/learn/summary')">
        <Icon icon="tabler:bolt" width="14" height="14" />
        <span>{{ earnStore.totalEarned }} sats</span>
      </div>
    </div>

    <!-- Scrollable Map -->
    <div ref="mapScroll" class="earn-map-scroll">

      <!-- Mountain top (finish line) -->
      <div class="earn-mountain-top">
        <img src="/Learn and Earn/education.svg" class="mountain-illustration" alt="" />
        <div class="mountain-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
          {{ $t('Learn & Earn') }}
        </div>
        <div class="mountain-subtitle">
          {{ earnStore.totalCompleted }}/{{ earnStore.totalQuestions }} {{ $t('completed') }}
        </div>
      </div>

      <!-- Chapter cards in zigzag layout -->
      <div class="earn-path">
        <div
          v-for="(chapter, index) in allChapters"
          :key="chapter.id"
          class="earn-path-segment"
        >
          <!-- Connecting dashed line -->
          <div
            v-if="index > 0"
            class="earn-connector"
            :class="index % 2 === 0 ? 'connector-left' : 'connector-right'"
          >
            <svg width="100%" height="60" viewBox="0 0 300 60" preserveAspectRatio="none">
              <path
                :d="index % 2 === 0 ? 'M240 0 C240 30 60 30 60 60' : 'M60 0 C60 30 240 30 240 60'"
                fill="none"
                :stroke="$q.dark.isActive ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'"
                stroke-width="2"
                stroke-dasharray="6 4"
              />
            </svg>
          </div>

          <!-- Chapter card -->
          <div
            class="earn-chapter-card"
            :class="[
              index % 2 === 0 ? 'card-align-left' : 'card-align-right',
              getChapterState(chapter) === 'completed' ? 'card-completed' : '',
              getChapterState(chapter) === 'active' ? 'card-active' : '',
              getChapterState(chapter) === 'locked' ? 'card-locked' : '',
              $q.dark.isActive ? 'card-dark' : 'card-light',
            ]"
            @click="openChapter(chapter)"
          >
            <!-- Progress bar at top -->
            <div class="card-progress-track">
              <div class="card-progress-fill" :style="{ width: getChapterProgress(chapter).percentage + '%' }" />
            </div>

            <!-- Card content -->
            <div class="card-body">
              <img :src="chapter.illustration" class="card-illustration" alt="" />
              <div class="card-info">
                <div class="card-title">{{ chapter.title }}</div>
                <div class="card-meta">
                  <template v-if="getChapterState(chapter) === 'completed'">
                    <Icon icon="tabler:circle-check-filled" width="14" height="14" class="meta-icon-done" />
                    {{ $t('completed') }}
                  </template>
                  <template v-else-if="getChapterState(chapter) === 'locked'">
                    <Icon icon="tabler:lock" width="14" height="14" class="meta-icon-lock" />
                    {{ $t('locked') }}
                  </template>
                  <template v-else>
                    {{ getChapterProgress(chapter).completed }}/{{ getChapterProgress(chapter).total }}
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom spacer -->
      <div class="earn-bottom-space" />
    </div>

    <!-- Bottom Nav -->
    <EarnBottomNav active-tab="lessons" />

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
                <Icon v-if="earnStore.selectedWalletId === wallet.id" icon="tabler:circle-check" width="20" height="20" style="color: #92E3A9;" />
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
import EarnBottomNav from '../components/EarnBottomNav.vue'

export default {
  name: 'EarnMap',
  components: { EarnBottomNav },
  setup() {
    const earnStore = useEarnStore()
    const walletStore = useWalletStore()
    return { earnStore, walletStore }
  },
  data() {
    return {
      showWalletPicker: false,
      pendingChapterId: null,
    }
  },
  computed: {
    /**
     * Flatten all chapters from all groups into a single list, top-to-bottom.
     * Each chapter gets a reference to its parent group for unlock checking.
     */
    allChapters() {
      const chapters = []
      for (const group of this.earnStore.groups) {
        for (const chapter of group.chapters) {
          chapters.push({ ...chapter, groupId: group.id })
        }
      }
      return chapters
    },
  },
  async created() {
    await this.earnStore.initialize()
  },
  mounted() {
    // Starts at top naturally — first lessons are at the top
    this.$nextTick(() => {
    })
  },
  methods: {
    getChapterState(chapter) {
      if (this.earnStore.isChapterComplete(chapter.id)) return 'completed'
      if (!this.earnStore.isGroupUnlocked(chapter.groupId)) return 'locked'
      return 'active'
    },

    getChapterProgress(chapter) {
      return this.earnStore.chapterProgress(chapter.id)
    },

    openChapter(chapter) {
      const state = this.getChapterState(chapter)
      if (state === 'locked') {
        this.$q.notify({ type: 'info', message: this.$t('Complete the previous group first') })
        return
      }

      if (!this.earnStore.selectedWalletId) {
        this.pendingChapterId = chapter.id
        this.showWalletPicker = true
        return
      }

      this.$router.push(`/learn/${chapter.id}`)
    },

    selectWallet(walletId) {
      this.earnStore.setSelectedWallet(walletId)
      this.showWalletPicker = false
      if (this.pendingChapterId) {
        this.$router.push(`/learn/${this.pendingChapterId}`)
        this.pendingChapterId = null
      }
    },
  }
}
</script>

<style scoped>
.earn-map-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.earn-dark {
  background: var(--bg-primary);
  background-image:
    radial-gradient(ellipse 600px 400px at 20% 10%, rgba(146, 227, 169, 0.04), transparent),
    radial-gradient(ellipse 500px 300px at 80% 50%, rgba(5, 149, 115, 0.03), transparent);
}

.earn-light {
  background: #F8F8F8;
  background-image:
    radial-gradient(ellipse 600px 400px at 20% 10%, rgba(146, 227, 169, 0.08), transparent),
    radial-gradient(ellipse 500px 300px at 80% 50%, rgba(5, 149, 115, 0.06), transparent);
}

/* Sticky Header */
.earn-map-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: calc(var(--safe-top, 0px) + 12px);
}

.earn-back { color: var(--text-secondary); }

.earn-sats-pill {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: #92E3A9;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.earn-dark .earn-sats-pill { background: rgba(146, 227, 169, 0.1); }
.earn-light .earn-sats-pill { background: rgba(5, 149, 115, 0.1); color: #059573; }

/* Scrollable Map */
.earn-map-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

/* Mountain Top */
.earn-mountain-top {
  text-align: center;
  padding: 20px 20px 40px;
}

.mountain-illustration {
  width: 320px;
  height: 240px;
  object-fit: contain;
  margin-bottom: 20px;
}

.mountain-title {
  font-family: 'Manrope', sans-serif;
  font-size: 26px;
  font-weight: 800;
}

.mountain-subtitle {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 4px;
}

/* Path Layout */
.earn-path {
  padding: 0 20px;
  max-width: 380px;
  margin: 0 auto;
}

.earn-path-segment {
  position: relative;
}

/* Connector Lines */
.earn-connector {
  height: 60px;
  padding: 0 10px;
}

/* Chapter Cards */
.earn-chapter-card {
  width: 78%;
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  margin-bottom: 4px;
}

.earn-chapter-card:active {
  transform: scale(0.96);
}

.card-align-left { margin-right: auto; }
.card-align-right { margin-left: auto; }

/* Card themes */
.card-dark {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.card-light {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* Card states */
.card-active {
  border-color: rgba(146, 227, 169, 0.3);
}

.earn-dark .card-active {
  background: rgba(146, 227, 169, 0.08);
  box-shadow: 0 0 20px rgba(146, 227, 169, 0.06);
}

.card-locked {
  opacity: 0.4;
  cursor: default;
}

.card-locked:active { transform: none; }

/* Progress bar */
.card-progress-track {
  height: 3px;
  background: rgba(255, 255, 255, 0.05);
}

.earn-light .card-progress-track { background: rgba(0, 0, 0, 0.05); }

.card-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #059573, #92E3A9);
  transition: width 0.4s ease;
}

/* Card body */
.card-body {
  padding: 16px;
  display: flex;
  gap: 14px;
  align-items: center;
}

.card-illustration {
  width: 80px;
  height: 80px;
  object-fit: contain;
  flex-shrink: 0;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text-primary);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 3px;
}

.meta-icon-done { color: #92E3A9; }
.meta-icon-lock { color: var(--text-muted); }

/* Bottom space for scroll */
.earn-bottom-space {
  height: 120px;
}

/* Wallet picker */
.wallet-picker-card { min-width: 300px; border-radius: 20px !important; }
.wallet-pick-item { border-radius: 12px; }

/* Locked label */
</style>
