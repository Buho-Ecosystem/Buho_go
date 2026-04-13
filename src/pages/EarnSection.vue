<template>
  <q-page class="earn-section-page" :class="$q.dark.isActive ? 'earn-dark' : 'earn-light'">

    <!-- Header -->
    <div class="section-header">
      <q-btn flat round dense @click="$router.back()" class="earn-back">
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>
      <div class="section-header-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
        {{ chapter?.title || '' }}
      </div>
      <div style="width: 40px;" />
    </div>

    <!-- Swipeable Question Cards -->
    <div v-if="chapter" class="section-carousel-wrap">
      <q-carousel
        v-model="currentSlide"
        swipeable
        animated
        transition-prev="slide-right"
        transition-next="slide-left"
        :navigation="false"
        :arrows="false"
        :infinite="false"
        class="section-carousel"
      >
        <q-carousel-slide
          v-for="(question, qIndex) in chapter.questions"
          :key="question.id"
          :name="question.id"
          class="section-slide"
        >
          <div
            class="question-card"
            :class="[
              $q.dark.isActive ? 'qcard-dark' : 'qcard-light',
              getQuestionState(question, qIndex) === 'active' ? 'qcard-active' : '',
            ]"
            @click="openQuestion(question, qIndex)"
          >
            <!-- Illustration -->
            <div class="qcard-illustration-wrap">
              <img :src="chapter.illustration" class="qcard-illustration" alt="" />
            </div>

            <!-- Content -->
            <div class="qcard-content">
              <h3 class="qcard-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ question.title }}
              </h3>

              <!-- Status -->
              <div v-if="earnStore.isQuestionCompleted(question.id)" class="qcard-status qcard-status-done">
                <Icon icon="tabler:circle-check-filled" width="18" height="18" />
                <span>1 sat {{ $t('earned') }}</span>
              </div>

              <div v-else-if="getQuestionState(question, qIndex) === 'locked'" class="qcard-status qcard-status-locked">
                <Icon icon="tabler:lock" width="16" height="16" />
                <span>{{ $t('Answer previous first') }}</span>
              </div>

              <div v-else class="qcard-status qcard-status-earn">
                <q-btn
                  unelevated no-caps
                  class="earn-sat-btn"
                  :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
                >
                  <Icon icon="tabler:bolt" width="16" height="16" class="q-mr-xs" />
                  {{ $t('Earn 1 sat') }}
                </q-btn>
              </div>
            </div>
          </div>
        </q-carousel-slide>
      </q-carousel>

      <!-- Dot Pagination -->
      <div class="section-dots">
        <span
          v-for="question in chapter.questions"
          :key="question.id"
          class="section-dot"
          :class="{
            'dot-active': currentSlide === question.id,
            'dot-completed': earnStore.isQuestionCompleted(question.id),
          }"
          @click="currentSlide = question.id"
        />
      </div>
    </div>
  </q-page>
</template>

<script>
import { useEarnStore } from '../stores/earn'

export default {
  name: 'EarnSection',
  setup() {
    const earnStore = useEarnStore()
    return { earnStore }
  },
  data() {
    return {
      currentSlide: null,
    }
  },
  computed: {
    chapterId() {
      return this.$route.params.sectionId
    },
    chapter() {
      return this.earnStore.getChapter(this.chapterId)
    },
  },
  async created() {
    await this.earnStore.initialize()
    // Auto-scroll to first incomplete question
    if (this.chapter) {
      const next = this.earnStore.nextQuestionInChapter(this.chapterId)
      this.currentSlide = next ? next.id : this.chapter.questions[0]?.id
    }
  },
  methods: {
    getQuestionState(question, qIndex) {
      if (this.earnStore.isQuestionCompleted(question.id)) return 'completed'
      if (qIndex === 0) return 'active'
      const prevDone = this.earnStore.isQuestionCompleted(this.chapter.questions[qIndex - 1].id)
      return prevDone ? 'active' : 'locked'
    },

    openQuestion(question, qIndex) {
      const state = this.getQuestionState(question, qIndex)
      if (state === 'locked') {
        this.$q.notify({ type: 'info', message: this.$t('Answer the previous question first') })
        return
      }
      if (state === 'completed') {
        // Allow reviewing completed questions
      }
      this.$router.push(`/learn/${this.chapterId}/${question.id}`)
    },
  }
}
</script>

<style scoped>
.earn-section-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.earn-dark {
  background: var(--bg-primary);
  background-image: radial-gradient(ellipse 500px 400px at 50% 30%, rgba(146, 227, 169, 0.03), transparent);
}
.earn-light {
  background: #F8F8F8;
  background-image: radial-gradient(ellipse 500px 400px at 50% 30%, rgba(146, 227, 169, 0.06), transparent);
}

/* Header */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: calc(var(--safe-top, 0px) + 12px);
}

.earn-back { color: var(--text-secondary); }

.section-header-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
}

/* Carousel */
.section-carousel-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 0 24px;
}

.section-carousel {
  flex: 1;
  background: transparent !important;
  max-height: 500px;
}

.section-slide {
  padding: 16px 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Question Card */
.question-card {
  width: 100%;
  max-width: 320px;
  border-radius: 24px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.question-card:active { transform: scale(0.97); }

.qcard-dark {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.qcard-light {
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.qcard-active.qcard-dark {
  border-color: rgba(146, 227, 169, 0.2);
  box-shadow: 0 0 30px rgba(146, 227, 169, 0.05);
}

/* Illustration */
.qcard-illustration-wrap {
  padding: 28px 28px 16px;
  display: flex;
  justify-content: center;
}

.qcard-illustration {
  width: 240px;
  height: 210px;
  object-fit: contain;
}

/* Content */
.qcard-content {
  padding: 0 24px 28px;
  text-align: center;
}

.qcard-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  margin: 0 0 16px 0;
}

/* Status badges */
.qcard-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

.qcard-status-done { color: #92E3A9; }
.qcard-status-locked { color: var(--text-muted); }

.earn-sat-btn {
  padding: 12px 28px;
  border-radius: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
}

/* Dots */
.section-dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 16px 20px;
}

.section-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s ease;
}

.earn-dark .section-dot { background: rgba(255, 255, 255, 0.15); }
.earn-light .section-dot { background: rgba(0, 0, 0, 0.12); }

.section-dot.dot-active {
  width: 28px;
  border-radius: 5px;
  background: linear-gradient(90deg, #059573, #92E3A9);
}

.section-dot.dot-completed {
  background: #92E3A9;
}
</style>
