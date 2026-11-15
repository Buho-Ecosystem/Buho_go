<!--
  EmojiPicker
  The searchable emoji list, the same in the desktop dock and the bottom
  sheet (EmojiPanel.vue decides which).

    - Search first: one ranked list across all categories (utils/emojiSearch.js),
      in English, German and Spanish words.
    - Browsing: the last 24 picks (or the quick reactions), then the curated
      catalog by category. The rail jumps to a category; its outline icons are
      navigation, not emoji to pick.
    - Keyboard: arrows move through the grid, Enter in the search field picks
      the best match, Home / End jump.
    - `finePointer` (a mouse or trackpad): the search field takes focus on
      opening and cells show their name on hover. On touch neither happens:
      focus would raise the keyboard over the list.

  Each cell's label is the emoji itself, which screen readers name in the
  system language. Events: `select` (the character), `close`.
-->
<template>
  <section class="emoji-picker" :aria-label="$t('Emoji')">
    <header class="emoji-picker__header">
      <h2>{{ $t(reaction ? 'React' : 'Emoji') }}</h2>
      <button type="button" class="emoji-picker__button" :aria-label="$t('Close emoji picker')" @click="$emit('close')">
        <Icon icon="tabler:x" width="20" height="20" />
      </button>
    </header>

    <div class="emoji-picker__search">
      <Icon icon="tabler:search" width="19" height="19" />
      <input
        ref="search"
        v-model="query"
        type="search"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        :placeholder="$t('Search emoji')"
        :aria-label="$t('Search emoji')"
        @keydown="onSearchKeydown"
      />
    </div>

    <div class="emoji-picker__body">
      <nav v-if="sections.length && !searching" class="emoji-picker__rail" :aria-label="$t('Emoji categories')">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          class="emoji-picker__category"
          :aria-label="$t(section.title)"
          :title="finePointer ? $t(section.title) : undefined"
          :aria-current="activeId === section.id ? 'true' : undefined"
          @click="jumpTo(section.id)"
        >
          <Icon :icon="section.icon" width="21" height="21" />
        </button>
      </nav>

      <div ref="scroller" class="emoji-picker__list" @scroll.passive="onScroll" @keydown="onGridKeydown">
        <section v-for="section in sections" :key="section.id" :data-section="section.id">
          <h3>{{ $t(section.title) }}</h3>
          <div class="emoji-picker__grid">
            <button
              v-for="entry in section.emojis"
              :key="entry.char"
              type="button"
              class="emoji-picker__cell"
              :data-emoji="entry.char"
              :title="finePointer ? entry.name : undefined"
              :tabindex="isTabStop(section, entry) ? 0 : -1"
              @focus="tabStop = section.id + entry.char"
              @click="pick(entry)"
            >{{ entry.char }}</button>
          </div>
        </section>

        <div v-if="!sections.length" class="emoji-picker__empty" role="status">
          <Icon icon="tabler:search-off" width="30" height="30" />
          <strong>{{ $t('No emoji found') }}</strong>
          <p>{{ $t('Try another word, like happy or heart.') }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue'
import { EMOJI_CATEGORIES, emojiEntry } from '../../utils/emojiCatalog.js'
import { normalizeQuery, scoreMatch, scoreTitle, translatedTerms } from '../../utils/emojiSearch.js'
import { REACTION_EMOJIS } from './chatFormat.js'
import './chatTokens.css'

/** Device preference, like the app's other `buho.<name>` keys. */
const RECENTS_KEY = 'buho.emojiRecents'
/** The key of the first version; read once so nobody loses their recents. */
const LEGACY_RECENTS_KEY = 'buho:emoji-recents'
const MAX_RECENTS = 24

/** Only emoji the catalog knows. Broken or unavailable storage never blocks choosing. */
function loadRecents() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? localStorage.getItem(LEGACY_RECENTS_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return [...new Set(saved.filter(char => typeof char === 'string' && emojiEntry(char)))].slice(0, MAX_RECENTS)
  } catch { return [] }
}

function saveRecents(recents) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    localStorage.removeItem(LEGACY_RECENTS_KEY)
  } catch { /* recents are a convenience */ }
}

export default {
  name: 'EmojiPicker',
  components: { Icon },
  props: {
    /** Picking a reaction (title "React") rather than emoji for the draft. */
    reaction: { type: Boolean, default: false },
    /** A mouse or trackpad: focus the search on opening, name cells on hover. */
    finePointer: { type: Boolean, default: false }
  },
  emits: ['select', 'close'],
  data() {
    return { query: '', recents: loadRecents(), activeId: 'recent', tabStop: null }
  },
  computed: {
    searching() { return normalizeQuery(this.query) !== '' },
    sections() {
      const recent = this.recents.length ? this.recents : REACTION_EMOJIS
      const all = [
        {
          id: 'recent',
          icon: 'tabler:history',
          title: this.recents.length ? 'Recently used' : 'Quick reactions',
          emojis: recent.map(emojiEntry).filter(Boolean)
        },
        ...EMOJI_CATEGORIES
      ]
      const query = normalizeQuery(this.query)
      if (!query) return all
      // Search is about the best match, regardless of its shelf or recent use.
      const translated = translatedTerms(query)
      const found = new Map()
      for (const section of all) {
        // The shelf's name in the app's language finds its emoji too ("Tiere").
        const localTitle = scoreTitle(normalizeQuery(this.$t(section.title)), query) ? 1 : 0
        for (const entry of section.emojis) {
          const score = Math.max(scoreMatch({ ...entry, keywords: [...entry.keywords, entry.char] }, section.title, query, translated), localTitle)
          if (score && (found.get(entry.char)?.score ?? 0) < score) found.set(entry.char, { entry, score })
        }
      }
      const emojis = [...found.values()].sort((a, b) => b.score - a.score).map(({ entry }) => entry)
      return emojis.length ? [{ id: 'results', title: 'Search results', emojis }] : []
    }
  },
  watch: {
    query() {
      this.tabStop = null
      this.$nextTick(() => {
        if (this.$refs.scroller) this.$refs.scroller.scrollTop = 0
        this.activeId = this.sections[0]?.id || ''
      })
    }
  },
  mounted() {
    if (this.finePointer) this.$refs.search?.focus({ preventScroll: true })
  },
  methods: {
    /** One cell is in the tab order: the last one focused, else the first. */
    isTabStop(section, entry) {
      if (this.tabStop) return this.tabStop === section.id + entry.char
      return section === this.sections[0] && entry === section.emojis[0]
    },
    pick(entry) {
      this.recents = [entry.char, ...this.recents.filter(char => char !== entry.char)].slice(0, MAX_RECENTS)
      saveRecents(this.recents)
      this.$emit('select', entry.char)
    },
    jumpTo(id) {
      const scroller = this.$refs.scroller
      if (!scroller) return
      const section = scroller.querySelector(`[data-section="${id}"]`)
      if (section) scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      this.activeId = id
    },
    onScroll() {
      const scroller = this.$refs.scroller
      if (!scroller) return
      const top = scroller.getBoundingClientRect().top
      let current = this.sections[0]?.id || ''
      for (const section of scroller.querySelectorAll('[data-section]')) {
        if (section.getBoundingClientRect().top - top > 3) break
        current = section.dataset.section
      }
      this.activeId = current
    },
    focusCell(cell) {
      cell?.focus({ preventScroll: true })
      if (!cell) return
      const scroller = this.$refs.scroller
      if (!scroller) return
      const bounds = scroller.getBoundingClientRect()
      const box = cell.getBoundingClientRect()
      if (box.top < bounds.top + 32) scroller.scrollTop += box.top - bounds.top - 32
      else if (box.bottom > bounds.bottom) scroller.scrollTop += box.bottom - bounds.bottom
    },
    onSearchKeydown(event) {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.focusCell(this.$refs.scroller.querySelector('[data-emoji]'))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const entry = this.sections[0]?.emojis[0]
        if (entry) this.pick(entry)
      }
    },
    onGridKeydown(event) {
      const cells = [...this.$refs.scroller.querySelectorAll('[data-emoji]')]
      const index = cells.indexOf(event.target)
      if (index < 0) return
      let target
      if (event.key === 'ArrowRight') target = cells[index + 1]
      else if (event.key === 'ArrowLeft') target = cells[index - 1]
      else if (event.key === 'Home') target = cells[0]
      else if (event.key === 'End') target = cells.at(-1)
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const origin = event.target.getBoundingClientRect()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        let rowTop = null
        let gap = Infinity
        for (let i = index + direction; i >= 0 && i < cells.length; i += direction) {
          const box = cells[i].getBoundingClientRect()
          if (Math.abs(box.top - origin.top) < 1) continue
          if (rowTop === null) rowTop = box.top
          if (Math.abs(box.top - rowTop) > 1) break
          if (Math.abs(box.left - origin.left) < gap) { target = cells[i]; gap = Math.abs(box.left - origin.left) }
        }
      } else return
      event.preventDefault()
      this.focusCell(target)
    }
  }
}
</script>

<style scoped>
.emoji-picker {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
}

.emoji-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 4px 20px;
}
.emoji-picker__header h2 { margin: 0; font-size: 1.125rem; font-weight: 750; line-height: 1.5; }

.emoji-picker__button,
.emoji-picker__category {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-ms);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.emoji-picker__search {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 46px;
  margin: 8px 16px 14px;
  padding: 0 12px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-xl);
  background: var(--bg-input);
  color: var(--text-secondary);
}
.emoji-picker__search:focus-within { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
.emoji-picker__search input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  /* 16px: below this iOS zooms the page on focus. */
  font-size: 1rem;
}
.emoji-picker__search input::placeholder { color: var(--text-secondary); }

.emoji-picker__body { display: flex; flex: 1; min-height: 0; }

.emoji-picker__rail {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 5px 8px;
  overflow-y: auto;
  scrollbar-width: none;
}
.emoji-picker__category { position: relative; }
.emoji-picker__category[aria-current='true'] { background: var(--brand-accent-soft); color: var(--text-primary); }
.emoji-picker__category[aria-current='true']::before {
  content: '';
  position: absolute;
  left: 0;
  width: 3px;
  height: 18px;
  border-radius: 3px;
  background: var(--brand-accent);
}

.emoji-picker__list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  /* The list is the sheet's last element: it clears the home indicator. */
  padding: 0 12px max(16px, var(--safe-bottom, 0px)) 4px;
}
.emoji-picker__list h3 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 10px 4px 7px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.5;
}
.emoji-picker__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 2px; }
.emoji-picker__cell {
  min-width: 44px;
  min-height: 46px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-ms);
  background: transparent;
  cursor: pointer;
  /* rem, so the glyphs follow the system text size like the rest of the chat. */
  font-size: 1.625rem;
  line-height: 1;
}
.emoji-picker__cell:active { transform: scale(.96); }
.emoji-picker__cell:focus-visible,
.emoji-picker__category:focus-visible,
.emoji-picker__button:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: -2px; background: var(--bg-input); }

/* Hover is a pointer's affair: a tapped cell must not stay highlighted on touch. */
@media (hover: hover) {
  .emoji-picker__button:hover,
  .emoji-picker__category:hover { background: var(--bg-input); }
  .emoji-picker__cell:hover { background: var(--bg-input); transform: scale(1.08); }
}

.emoji-picker__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 36px 18px;
  text-align: center;
  color: var(--text-secondary);
}
.emoji-picker__empty strong { color: var(--text-primary); font-size: 0.9375rem; }
.emoji-picker__empty p { margin: 0; font-size: 0.8125rem; }

/* The narrowest phones: the grid gets the rail's width, search and the section names still find everything. */
@media (max-width: 359px) {
  .emoji-picker__rail { display: none; }
  .emoji-picker__list { padding-left: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .emoji-picker__cell:hover,
  .emoji-picker__cell:active { transform: none; }
}
</style>
