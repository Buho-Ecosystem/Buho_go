<template>
  <q-page class="question-page" :class="$q.dark.isActive ? 'learn-dark' : 'learn-light'">
    <!-- Header -->
    <div class="question-header">
      <q-btn flat round dense @click="$router.back()" class="learn-back">
        <Icon icon="tabler:x" width="18" height="18" />
      </q-btn>
      <div class="question-progress-mini">
        <div class="question-progress-fill" :style="{ width: progressPercent + '%' }" />
      </div>
      <div class="question-sats-badge">
        <Icon icon="tabler:bolt" width="12" height="12" />
        {{ earnStore.totalEarned }}
      </div>
    </div>

    <q-scroll-area v-if="question" class="question-scroll">
      <div class="question-body">
      <!-- State: Quiz (lesson + answers on same page) -->
      <transition name="q-fade" mode="out-in">
        <div v-if="state === 'quiz'" key="quiz" class="quiz-view">
          <!-- Lesson text -->
          <h2 class="lesson-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ question.title }}
          </h2>
          <p class="lesson-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ question.text }}
          </p>

          <!-- Question + Answers -->
          <div class="quiz-divider" />
          <h3 class="quiz-question" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ question.question }}
          </h3>
          <div class="quiz-answers">
            <button
              v-for="(answer, index) in shuffledAnswers"
              :key="index"
              class="quiz-answer-btn"
              :class="getAnswerClass(index)"
              :disabled="selectedAnswer !== null"
              @click="selectAnswer(index)"
            >
              <span class="answer-letter">{{ ['A', 'B', 'C'][index] }}</span>
              <span class="answer-text">{{ answer.text }}</span>
              <Icon
                v-if="selectedAnswer === index && answer.correct"
                icon="tabler:circle-check-filled" width="20" height="20"
                class="answer-icon-correct"
              />
              <Icon
                v-if="selectedAnswer === index && !answer.correct"
                icon="tabler:circle-x-filled" width="20" height="20"
                class="answer-icon-wrong"
              />
            </button>
          </div>
        </div>

        <!-- State: Feedback (correct) -->
        <div v-else-if="state === 'correct'" key="correct" class="feedback-view feedback-correct">
          <div class="feedback-icon-wrap feedback-icon-correct">
            <Icon icon="tabler:check" width="32" height="32" />
          </div>
          <h2 class="feedback-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ $t('Correct!') }}
          </h2>
          <p class="feedback-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ feedbackText }}
          </p>
          <div class="feedback-sat-earned">
            <Icon icon="tabler:bolt" width="16" height="16" />
            +1 sat
          </div>
          <div class="feedback-action">
            <q-btn
              unelevated no-caps
              :label="hasNextQuestion ? $t('Next Question') : $t('Continue')"
              @click="handleNext"
              class="lesson-btn"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            />
          </div>
        </div>

        <!-- State: Feedback (wrong) -->
        <div v-else-if="state === 'wrong'" key="wrong" class="feedback-view feedback-wrong">
          <div class="feedback-icon-wrap feedback-icon-wrong">
            <Icon icon="tabler:x" width="32" height="32" />
          </div>
          <h2 class="feedback-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ $t('Not quite') }}
          </h2>
          <p class="feedback-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ feedbackText }}
          </p>
          <div class="feedback-action">
            <q-btn
              unelevated no-caps
              :label="$t('Try Again')"
              @click="retry"
              class="lesson-btn retry-btn"
            />
          </div>
        </div>
      </transition>
      </div>
    </q-scroll-area>

    <!-- Payout Celebration Overlay -->
    <q-dialog v-model="showPayout" persistent>
      <q-card class="payout-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="payout-content">
          <div class="payout-icon">
            <Icon icon="tabler:confetti" width="48" height="48" style="color: #15DE72;" />
          </div>
          <h3 class="payout-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ payoutBonus ? $t('You did it!') : $t('Payout!') }}
          </h3>
          <p class="payout-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <template v-if="payoutBonus">
              {{ $t('All questions completed! Your sats have been doubled.') }}
            </template>
            <template v-else>
              {{ $t('{amount} sats sent to your wallet', { amount: payoutAmount }) }}
            </template>
          </p>
          <div class="payout-amount">
            {{ payoutBonus ? payoutAmount + ' bonus sats' : payoutAmount + ' sats' }}
          </div>
        </q-card-section>
        <q-card-actions align="center" class="q-pb-md">
          <q-btn
            unelevated no-caps
            :label="payoutBonus ? $t('Amazing!') : $t('Continue')"
            @click="closePayout"
            class="lesson-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            style="min-width: 200px;"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { useEarnStore } from '../stores/earn'

export default {
  name: 'LearnQuestion',
  setup() {
    const earnStore = useEarnStore()
    return { earnStore }
  },
  data() {
    return {
      state: 'quiz', // quiz | correct | wrong
      selectedAnswer: null,
      feedbackText: '',
      shuffledAnswers: [],
      showPayout: false,
      payoutAmount: 0,
      payoutBonus: false,
    }
  },
  computed: {
    questionId() {
      return this.$route.params.questionId
    },
    groupId() {
      return this.$route.params.groupId
    },
    question() {
      return this.earnStore.getQuestion(this.questionId)
    },
    chapter() {
      if (!this.question) return null
      const chapterId = this.questionId.split('.')[0]
      return this.earnStore.getChapter(chapterId)
    },
    progressPercent() {
      if (!this.chapter) return 0
      const total = this.chapter.questions.length
      const done = this.chapter.questions.filter(q => this.earnStore.isQuestionCompleted(q.id)).length
      return Math.round((done / total) * 100)
    },
    hasNextQuestion() {
      if (!this.chapter) return false
      const idx = this.chapter.questions.findIndex(q => q.id === this.questionId)
      return idx < this.chapter.questions.length - 1
    },
    nextQuestion() {
      if (!this.chapter) return null
      const idx = this.chapter.questions.findIndex(q => q.id === this.questionId)
      return idx < this.chapter.questions.length - 1 ? this.chapter.questions[idx + 1] : null
    },
  },
  async created() {
    await this.earnStore.initialize()
    if (this.question) {
      this.shuffleAnswers()
    }
  },
  methods: {
    shuffleAnswers() {
      if (!this.question) return
      // answers[0] is always correct. Create objects with correct flag, then shuffle.
      const mapped = this.question.answers.map((text, i) => ({
        text,
        feedback: this.question.feedback[i],
        correct: i === 0,
      }))
      // Fisher-Yates shuffle
      for (let i = mapped.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mapped[i], mapped[j]] = [mapped[j], mapped[i]]
      }
      this.shuffledAnswers = mapped
    },

    getAnswerClass(index) {
      const base = this.$q.dark.isActive ? 'answer-dark' : 'answer-light'
      if (this.selectedAnswer === null) return base
      if (this.selectedAnswer !== index) return base + ' answer-dimmed'
      return base + (this.shuffledAnswers[index].correct ? ' answer-correct' : ' answer-wrong')
    },

    selectAnswer(index) {
      if (this.selectedAnswer !== null) return
      this.selectedAnswer = index
      const answer = this.shuffledAnswers[index]
      this.feedbackText = answer.feedback

      setTimeout(() => {
        if (answer.correct) {
          const result = this.earnStore.markQuestionComplete(this.questionId)
          this.state = 'correct'

          // Check for payout
          if (result.shouldPayout) {
            setTimeout(() => this.triggerPayout(), 800)
          }
          // Check for completion bonus
          if (result.allCompleted && !this.earnStore.bonusPaid) {
            setTimeout(() => this.triggerCompletionBonus(), result.shouldPayout ? 3000 : 800)
          }
        } else {
          this.state = 'wrong'
        }
      }, 600)
    },

    retry() {
      this.state = 'quiz'
      this.selectedAnswer = null
      this.feedbackText = ''
      this.shuffleAnswers()
    },

    handleNext() {
      if (this.hasNextQuestion && this.nextQuestion) {
        this.$router.replace(`/learn/${this.groupId}/${this.nextQuestion.id}`)
        this.state = 'quiz'
        this.selectedAnswer = null
        this.feedbackText = ''
        this.$nextTick(() => this.shuffleAnswers())
      } else {
        // Chapter complete — go back to chapter list
        this.$router.back()
      }
    },

    async triggerPayout() {
      const result = await this.earnStore.executePayout()
      this.payoutAmount = result.amount
      this.payoutBonus = false
      this.showPayout = true
    },

    async triggerCompletionBonus() {
      const result = await this.earnStore.executeCompletionBonus()
      this.payoutAmount = result.bonus
      this.payoutBonus = true
      this.showPayout = true
    },

    closePayout() {
      this.showPayout = false
    },
  }
}
</script>

<style scoped>
.question-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.learn-dark { background: var(--bg-primary); }
.learn-light { background: #F8F8F8; }

/* Header */
.question-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  padding-top: calc(var(--safe-top, 0px) + 12px);
}

.learn-back { color: var(--text-secondary); flex-shrink: 0; }

.question-progress-mini {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-input);
  overflow: hidden;
}

.question-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #059573, #15DE72);
  transition: width 0.5s ease;
}

.question-sats-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 700;
  color: #15DE72;
  flex-shrink: 0;
}

/* Scroll area */
.question-scroll {
  flex: 1;
  min-height: 0;
}

/* Body */
.question-body {
  padding: 16px 20px;
  padding-bottom: max(32px, env(safe-area-inset-bottom));
}

.lesson-title {
  font-family: 'Manrope', sans-serif;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.2;
  margin: 0 0 16px 0;
}

.lesson-text {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.7;
  margin: 0;
  flex: 1;
}

.lesson-action {
  margin-top: 24px;
}

.lesson-btn {
  width: 100%;
  padding: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
  border-radius: 14px;
}

/* Quiz View */
.quiz-view {}

.quiz-divider {
  height: 1px;
  background: var(--border-card);
  margin: 24px 0;
}

.quiz-question {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  margin: 0 0 24px 0;
}

.quiz-answers {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.quiz-answer-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  border: 2px solid transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.answer-dark {
  background: var(--bg-card);
  color: var(--text-primary);
  border-color: var(--border-card);
}

.answer-light {
  background: #FFF;
  color: #1F2937;
  border-color: #E5E7EB;
}

.quiz-answer-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.answer-dimmed { opacity: 0.4; }

.answer-correct {
  border-color: #15DE72 !important;
  background: rgba(21, 222, 114, 0.1) !important;
}

.answer-wrong {
  border-color: #FF4444 !important;
  background: rgba(255, 68, 68, 0.1) !important;
}

.answer-letter {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
  background: var(--bg-input);
}

.answer-text { flex: 1; }

.answer-icon-correct { color: #15DE72; flex-shrink: 0; }
.answer-icon-wrong { color: #FF4444; flex-shrink: 0; }

/* Feedback Views */
.feedback-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding-top: 60px;
}

.feedback-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  animation: feedbackPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes feedbackPop {
  0% { transform: scale(0); }
  100% { transform: scale(1); }
}

.feedback-icon-correct {
  background: rgba(21, 222, 114, 0.15);
  color: #15DE72;
}

.feedback-icon-wrong {
  background: rgba(255, 68, 68, 0.15);
  color: #FF4444;
}

.feedback-title {
  font-family: 'Manrope', sans-serif;
  font-size: 24px;
  font-weight: 800;
  margin: 0 0 8px 0;
}

.feedback-text {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 400;
  line-height: 1.6;
  margin: 0 0 20px 0;
  max-width: 300px;
}

.feedback-sat-earned {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 24px;
  animation: satBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both;
}

@keyframes satBounce {
  0% { transform: scale(0) translateY(10px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

.feedback-action {
  width: 100%;
  max-width: 320px;
}

.retry-btn {
  background: var(--bg-card) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-card) !important;
}

/* Payout Card */
.payout-card {
  border-radius: 24px !important;
  text-align: center;
  min-width: 300px;
}

.payout-content {
  padding: 32px 24px 16px;
}

.payout-icon {
  margin-bottom: 16px;
  animation: feedbackPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.payout-title {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 800;
  margin: 0 0 8px 0;
}

.payout-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 16px 0;
}

.payout-amount {
  font-family: 'Manrope', sans-serif;
  font-size: 28px;
  font-weight: 800;
  color: #15DE72;
  animation: satBounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both;
}
</style>
