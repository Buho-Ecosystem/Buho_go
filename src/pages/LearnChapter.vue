<template>
  <q-page class="chapter-page" :class="$q.dark.isActive ? 'learn-dark' : 'learn-light'">
    <!-- Header -->
    <div class="chapter-header">
      <q-btn flat round dense @click="$router.back()" class="learn-back">
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="chapter-header-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
        {{ group?.title || '' }}
      </div>
      <div style="width: 40px;" />
    </div>

    <div v-if="group" class="chapter-list">
      <div
        v-for="chapter in group.chapters"
        :key="chapter.id"
        class="chapter-card"
        :class="$q.dark.isActive ? 'card-dark' : 'card-light'"
      >
        <div class="chapter-card-header" @click="toggleChapter(chapter.id)">
          <div class="chapter-card-info">
            <div class="chapter-card-title" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
              {{ chapter.title }}
            </div>
            <div class="chapter-card-progress" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ getProgress(chapter.id).completed }}/{{ getProgress(chapter.id).total }}
              <Icon
                v-if="earnStore.isChapterComplete(chapter.id)"
                icon="tabler:circle-check-filled"
                width="14" height="14"
                style="color: #15DE72; margin-left: 4px;"
              />
            </div>
          </div>
          <Icon
            :icon="expandedChapter === chapter.id ? 'tabler:chevron-up' : 'tabler:chevron-down'"
            width="18" height="18"
            class="chapter-expand-icon"
          />
        </div>

        <!-- Question list (expandable) -->
        <q-slide-transition>
          <div v-show="expandedChapter === chapter.id" class="chapter-questions">
            <div
              v-for="(question, qIndex) in chapter.questions"
              :key="question.id"
              class="question-row"
              :class="{
                'question-done': earnStore.isQuestionCompleted(question.id),
                'question-next': isNextQuestion(chapter, qIndex),
                'question-locked': isQuestionLocked(chapter, qIndex),
              }"
              @click="openQuestion(chapter, question, qIndex)"
            >
              <div class="question-indicator">
                <Icon v-if="earnStore.isQuestionCompleted(question.id)" icon="tabler:circle-check-filled" width="18" height="18" style="color: #15DE72;" />
                <div v-else-if="isNextQuestion(chapter, qIndex)" class="question-dot question-dot-active" />
                <div v-else class="question-dot" />
              </div>
              <div class="question-label" :class="$q.dark.isActive ? 'text-white' : 'text-dark'">
                {{ question.title }}
              </div>
              <div class="question-reward" :class="$q.dark.isActive ? 'text-grey-6' : 'text-grey-5'">
                +1 sat
              </div>
            </div>
          </div>
        </q-slide-transition>
      </div>
    </div>
  </q-page>
</template>

<script>
import { useEarnStore } from '../stores/earn'

export default {
  name: 'LearnChapter',
  setup() {
    const earnStore = useEarnStore()
    return { earnStore }
  },
  data() {
    return {
      expandedChapter: null,
    }
  },
  computed: {
    groupId() {
      return this.$route.params.groupId
    },
    group() {
      return this.earnStore.groups.find(g => g.id === this.groupId) || null
    },
  },
  async created() {
    await this.earnStore.initialize()
    // Auto-expand first incomplete chapter
    if (this.group) {
      for (const chapter of this.group.chapters) {
        if (!this.earnStore.isChapterComplete(chapter.id)) {
          this.expandedChapter = chapter.id
          break
        }
      }
    }
  },
  methods: {
    getProgress(chapterId) {
      return this.earnStore.chapterProgress(chapterId)
    },

    toggleChapter(chapterId) {
      this.expandedChapter = this.expandedChapter === chapterId ? null : chapterId
    },

    isNextQuestion(chapter, qIndex) {
      if (qIndex === 0) return !this.earnStore.isQuestionCompleted(chapter.questions[0].id)
      const prevDone = this.earnStore.isQuestionCompleted(chapter.questions[qIndex - 1].id)
      const thisDone = this.earnStore.isQuestionCompleted(chapter.questions[qIndex].id)
      return prevDone && !thisDone
    },

    isQuestionLocked(chapter, qIndex) {
      if (qIndex === 0) return false
      return !this.earnStore.isQuestionCompleted(chapter.questions[qIndex - 1].id)
    },

    openQuestion(chapter, question, qIndex) {
      if (this.earnStore.isQuestionCompleted(question.id)) return // Already done
      if (this.isQuestionLocked(chapter, qIndex)) {
        this.$q.notify({ type: 'info', message: this.$t('Answer the previous question first') })
        return
      }
      this.$router.push(`/learn/${this.groupId}/${question.id}`)
    },
  }
}
</script>

<style scoped>
.chapter-page {
  min-height: 100vh;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
}

.learn-dark { background: var(--bg-primary); }
.learn-light { background: #F8F8F8; }

.chapter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: calc(var(--safe-top, 0px) + 12px);
}

.learn-back { color: var(--text-secondary); }

.chapter-header-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 700;
}

/* Chapter Cards */
.chapter-list {
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chapter-card {
  border-radius: 14px;
  border: 1px solid var(--border-card);
  overflow: hidden;
}

.card-dark { background: var(--bg-card); }
.card-light { background: #FFF; }

.chapter-card-header {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.chapter-card-info {
  flex: 1;
}

.chapter-card-title {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
}

.chapter-card-progress {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 400;
  margin-top: 2px;
  display: flex;
  align-items: center;
}

.chapter-expand-icon { color: var(--text-muted); }

/* Questions */
.chapter-questions {
  padding: 0 12px 12px;
}

.question-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.question-row:active:not(.question-locked):not(.question-done) {
  background: var(--bg-input);
}

.question-done {
  opacity: 0.5;
  cursor: default;
}

.question-locked {
  opacity: 0.35;
  cursor: default;
}

.question-next {
  background: rgba(21, 222, 114, 0.06);
}

.question-indicator {
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.question-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--text-muted);
}

.question-dot-active {
  border-color: #15DE72;
  background: rgba(21, 222, 114, 0.3);
}

.question-label {
  flex: 1;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

.question-reward {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
</style>
