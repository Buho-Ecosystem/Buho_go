<template>
  <q-page class="earn-quiz-page" :class="$q.dark.isActive ? 'earn-dark' : 'earn-light'">

    <div v-if="question" class="quiz-layout">
      <!-- Close button -->
      <q-btn flat round dense class="quiz-close" @click="goBack">
        <Icon icon="tabler:x" width="22" height="22" />
      </q-btn>

      <!-- Scrollable lesson content -->
      <div class="quiz-scroll">
        <!-- Illustration -->
        <div class="quiz-illustration-wrap">
          <img :src="chapterIllustration" class="quiz-illustration" alt="" />
        </div>

        <!-- Lesson content -->
        <div class="quiz-lesson">
          <h1 class="quiz-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
            {{ question.title }}
          </h1>
          <p class="quiz-text" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ question.text }}
          </p>
        </div>
      </div>

      <!-- Bottom action bar -->
      <div class="quiz-bottom-bar">
        <template v-if="earnStore.isQuestionCompleted(question.id)">
          <div class="quiz-completed-info">
            <Icon icon="tabler:circle-check-filled" width="18" height="18" style="color: #92E3A9;" />
            <span>{{ $t('Lesson completed and 1 sat earned') }}</span>
          </div>
          <q-btn flat no-caps class="review-btn" @click="showAnswerSheet = true">
            {{ $t('Review lesson') }}
          </q-btn>
        </template>
        <template v-else>
          <q-btn
            unelevated no-caps
            class="earn-cta-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            @click="openAnswerSheet"
          >
            <Icon icon="tabler:bolt" width="18" height="18" class="q-mr-sm" />
            {{ $t('Earn 1 sat') }}
          </q-btn>
        </template>
      </div>
    </div>

    <!-- Answer Bottom Sheet -->
    <q-dialog
      v-model="showAnswerSheet"
      position="bottom"
      :seamless="false"
    >
      <q-card class="answer-sheet" :class="$q.dark.isActive ? 'sheet-dark' : 'sheet-light'">
        <!-- Drag handle -->
        <div class="sheet-handle-wrap">
          <div class="sheet-handle" />
        </div>

        <!-- Question -->
        <div class="sheet-question" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
          {{ question?.question }}
        </div>

        <!-- Answer options -->
        <div class="sheet-answers">
          <button
            v-for="(answer, index) in shuffledAnswers"
            :key="index"
            class="sheet-answer-btn"
            :class="getAnswerBtnClass(index)"
            :disabled="disabledAnswers.includes(index)"
            @click="tapAnswer(index)"
          >
            <div class="answer-circle" :class="getCircleClass(index)">
              {{ ['A', 'B', 'C'][index] }}
            </div>
            <span class="answer-label">{{ answer.text }}</span>
            <Icon
              v-if="lastTapped === index && answer.correct"
              icon="tabler:check" width="18" height="18"
              class="answer-result-icon correct-icon"
            />
            <Icon
              v-if="lastTapped === index && !answer.correct"
              icon="tabler:x" width="18" height="18"
              class="answer-result-icon wrong-icon"
            />
          </button>
        </div>

        <!-- Feedback -->
        <transition name="q-fade">
          <div v-if="feedbackText" class="sheet-feedback" :class="isCorrect ? 'feedback-correct' : 'feedback-wrong'">
            {{ feedbackText }}
          </div>
        </transition>

        <!-- Sat earned animation -->
        <transition name="sat-pop">
          <div v-if="showSatEarned" class="sheet-sat-earned">
            <Icon icon="tabler:bolt" width="16" height="16" />
            +1 sat
          </div>
        </transition>

        <!-- Next button (after correct) -->
        <transition name="q-fade">
          <div v-if="isCorrect" class="sheet-next-wrap">
            <q-btn
              unelevated no-caps
              class="sheet-next-btn"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              @click="handleNext"
            >
              {{ hasNextQuestion ? $t('Next Question') : $t('Done') }}
            </q-btn>
          </div>
        </transition>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<script>
import { useEarnStore } from '../stores/earn'

export default {
  name: 'EarnQuiz',
  setup() {
    const earnStore = useEarnStore()
    return { earnStore }
  },
  data() {
    return {
      showAnswerSheet: false,
      shuffledAnswers: [],
      lastTapped: null,
      disabledAnswers: [],
      feedbackText: '',
      isCorrect: false,
      showSatEarned: false,
    }
  },
  computed: {
    chapterId() {
      return this.$route.params.sectionId
    },
    questionId() {
      return this.$route.params.questionId
    },
    question() {
      return this.earnStore.getQuestion(this.questionId)
    },
    chapter() {
      return this.earnStore.getChapter(this.chapterId)
    },
    chapterIllustration() {
      return this.chapter?.illustration || '/Learn and Earn/education.svg'
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
  },
  methods: {
    openAnswerSheet() {
      this.earnStore.startQuestionTimer()
      this.shuffleAnswers()
      this.lastTapped = null
      this.disabledAnswers = []
      this.feedbackText = ''
      this.isCorrect = false
      this.showSatEarned = false
      this.showAnswerSheet = true
    },

    shuffleAnswers() {
      if (!this.question) return
      const mapped = this.question.answers.map((text, i) => ({
        text,
        feedback: this.question.feedback[i],
        correct: i === 0,
      }))
      for (let i = mapped.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mapped[i], mapped[j]] = [mapped[j], mapped[i]]
      }
      this.shuffledAnswers = mapped
    },

    tapAnswer(index) {
      if (this.isCorrect || this.disabledAnswers.includes(index)) return

      this.lastTapped = index
      const answer = this.shuffledAnswers[index]
      this.feedbackText = answer.feedback

      if (answer.correct) {
        this.isCorrect = true
        this.earnStore.markQuestionComplete(this.questionId)

        // Show sat earned animation
        setTimeout(() => { this.showSatEarned = true }, 300)
      } else {
        // Disable wrong answer so they can't tap it again
        this.disabledAnswers.push(index)
      }
    },

    getAnswerBtnClass(index) {
      const base = this.$q.dark.isActive ? 'abtn-dark' : 'abtn-light'
      if (this.lastTapped !== index) {
        if (this.disabledAnswers.includes(index)) return base + ' abtn-disabled'
        return base
      }
      return base + (this.shuffledAnswers[index].correct ? ' abtn-correct' : ' abtn-wrong')
    },

    getCircleClass(index) {
      if (this.lastTapped === index && this.shuffledAnswers[index].correct) return 'circle-correct'
      if (this.lastTapped === index && !this.shuffledAnswers[index].correct) return 'circle-wrong'
      if (this.disabledAnswers.includes(index)) return 'circle-disabled'
      return ''
    },

    handleNext() {
      this.showAnswerSheet = false
      if (this.hasNextQuestion && this.nextQuestion) {
        this.$router.replace(`/learn/${this.chapterId}/${this.nextQuestion.id}`)
      } else {
        this.$router.back()
      }
    },

    goBack() {
      this.$router.back()
    },
  }
}
</script>

<style scoped>
.earn-quiz-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.earn-dark {
  background: var(--bg-primary);
  background-image: radial-gradient(ellipse 500px 400px at 50% 20%, rgba(146, 227, 169, 0.03), transparent);
}
.earn-light {
  background: var(--bg-primary);
  background-image: radial-gradient(ellipse 500px 400px at 50% 20%, rgba(146, 227, 169, 0.06), transparent);
}

.quiz-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Close */
.quiz-close {
  position: absolute;
  top: calc(var(--safe-top, 0px) + 12px);
  right: 16px;
  z-index: 5;
  color: var(--text-secondary);
}

/* Scroll area */
.quiz-scroll {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 100px;
}

/* Illustration */
.quiz-illustration-wrap {
  padding: 60px 40px 20px;
  display: flex;
  justify-content: center;
}

.quiz-illustration {
  width: 280px;
  height: 230px;
  object-fit: contain;
}

/* Lesson */
.quiz-lesson {
  padding: 0 24px;
}

.quiz-title {
  font-family: 'Manrope', sans-serif;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.2;
  margin: 0 0 16px 0;
}

.quiz-text {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 400;
  line-height: 1.7;
  margin: 0;
}

/* Bottom bar */
.quiz-bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px 24px;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  text-align: center;
}

.earn-dark .quiz-bottom-bar { background: linear-gradient(transparent, #0a0e1a 30%); }
.earn-light .quiz-bottom-bar { background: linear-gradient(transparent, #f0f4fa 30%); }

.earn-cta-btn {
  width: 100%;
  max-width: 340px;
  padding: 16px;
  border-radius: 16px;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
}

.quiz-completed-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #92E3A9;
  margin-bottom: 8px;
}

.review-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
}

/* ═══ Answer Bottom Sheet ═══ */
.answer-sheet {
  border-radius: 24px 24px 0 0 !important;
  max-height: 75vh;
  width: 100%;
}

.sheet-dark { background: var(--bg-card, #1A1A1A) !important; }
.sheet-light { background: var(--bg-card) !important; }

.sheet-handle-wrap {
  display: flex;
  justify-content: center;
  padding: 12px 0 4px;
}

.sheet-handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
}

.sheet-dark .sheet-handle { background: rgba(255, 255, 255, 0.1); }
.sheet-light .sheet-handle { background: rgba(0, 0, 0, 0.1); }

.sheet-question {
  padding: 16px 24px 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.3;
}

/* Answer Buttons */
.sheet-answers {
  padding: 0 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sheet-answer-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 16px;
  border: 2px solid transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.sheet-answer-btn:active:not(:disabled) { transform: scale(0.98); }

.abtn-dark {
  background: var(--bg-input, #1E1E1E);
  color: var(--text-primary);
  border-color: var(--border-card, #2A342A);
}

.abtn-light {
  background: var(--bg-input);
  color: var(--text-primary);
  border-color: var(--border-card);
}

.abtn-correct { border-color: var(--color-green, #15DE72) !important; background: rgba(21, 222, 114, 0.1) !important; }
.abtn-wrong { border-color: var(--color-red, #FF4444) !important; background: rgba(255, 68, 68, 0.1) !important; }
.abtn-disabled { opacity: 0.35; cursor: default; }

/* Answer circle letter */
.answer-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 14px;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.sheet-dark .answer-circle { background: var(--bg-secondary, #171717); color: var(--text-secondary); }
.sheet-light .answer-circle { background: #E5E7EB; color: var(--text-muted); }

.circle-correct { background: var(--color-green, #15DE72) !important; color: #0C0C0C !important; }
.circle-wrong { background: var(--color-red, #FF4444) !important; color: #FFF !important; }
.circle-disabled { opacity: 0.35; }

.answer-label { flex: 1; }

.answer-result-icon { flex-shrink: 0; }
.correct-icon { color: var(--color-green, #15DE72); }
.wrong-icon { color: var(--color-red, #FF4444); }

/* Feedback */
.sheet-feedback {
  padding: 14px 24px;
  margin: 12px 20px 0;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
}

.feedback-correct { background: rgba(21, 222, 114, 0.1); color: var(--color-green, #15DE72); }
.feedback-wrong { background: rgba(255, 68, 68, 0.1); color: var(--color-red, #FF4444); }

/* Sat earned */
.sheet-sat-earned {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 800;
  color: #92E3A9;
}

.sat-pop-enter-active { animation: satPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes satPop {
  0% { transform: scale(0) translateY(10px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

/* Next button */
.sheet-next-wrap {
  padding: 8px 20px 20px;
  padding-bottom: max(20px, env(safe-area-inset-bottom));
}

.sheet-next-btn {
  width: 100%;
  padding: 16px;
  border-radius: 16px;
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 700;
}

/* ═══ Payout Card ═══ */
.payout-card { border-radius: 24px !important; text-align: center; min-width: 300px; }
.payout-content { padding: 32px 24px 16px; }
.payout-icon { margin-bottom: 16px; }
.payout-title { font-family: 'Manrope', sans-serif; font-size: 22px; font-weight: 800; margin: 0 0 8px 0; }
.payout-text { font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0; }
.payout-amount { font-family: 'Manrope', sans-serif; font-size: 32px; font-weight: 800; color: #92E3A9; }
.payout-continue-btn { min-width: 200px; padding: 14px; border-radius: 14px; font-size: 16px; font-weight: 600; }
</style>
