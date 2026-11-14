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
      <input ref="search" v-model="query" type="search" :placeholder="$t('Search emoji')"
        :aria-label="$t('Search emoji')" autocomplete="off" autocapitalize="none" spellcheck="false"
        @keydown="onSearchKeydown" />
    </div>
    <div class="emoji-picker__body">
      <nav v-if="sections.length && !query.trim()" class="emoji-picker__rail" :aria-label="$t('Emoji categories')">
        <button v-for="section in sections" :key="section.id" type="button" class="emoji-picker__category"
          :aria-label="$t(section.title)" :title="$t(section.title)" :aria-current="activeId === section.id ? 'true' : undefined"
          @click="jumpTo(section.id)">
          <Icon v-if="section.id === 'recent'" icon="tabler:history" width="21" height="21" />
          <span v-else aria-hidden="true">{{ section.icon }}</span>
        </button>
      </nav>
      <div ref="scroller" class="emoji-picker__list" @scroll.passive="onScroll" @keydown="onGridKeydown">
        <section v-for="section in sections" :key="section.id" :data-section="section.id">
          <h3>{{ $t(section.title) }}</h3>
          <div class="emoji-picker__grid">
            <button v-for="entry in section.emojis" :key="entry.char" type="button" class="emoji-picker__cell"
              :data-emoji="entry.char" :aria-label="entry.name" :title="entry.name"
              :tabindex="tabStop === section.id + entry.char || (!tabStop && section === sections[0] && entry === section.emojis[0]) ? 0 : -1"
              @focus="tabStop = section.id + entry.char; preview = entry"
              @mouseenter="preview = entry" @click="pick(entry)">{{ entry.char }}</button>
          </div>
        </section>
        <div v-if="!sections.length" class="emoji-picker__empty" role="status">
          <span aria-hidden="true">🔎</span>
          <strong>{{ $t('No emoji found') }}</strong>
          <p>{{ $t('Try another word, like happy or heart.') }}</p>
        </div>
      </div>
    </div>
    <footer class="emoji-picker__preview" aria-hidden="true">
      <span>{{ preview?.char || '☺️' }}</span>
      <span>{{ preview?.name || $t('A little expression goes a long way') }}</span>
    </footer>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue'
import { EMOJI_CATEGORIES, emojiEntry } from '../../utils/emojiCatalog.js'
import { normalizeQuery, scoreEmoji, scoreTitle } from '../../utils/emojiSearch.js'
import { REACTION_EMOJIS } from './chatFormat.js'

const RECENTS_KEY = 'buho:emoji-recents'
// Accept only known Unicode entries. Broken or unavailable storage never blocks choosing.
function loadRecents() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(saved) ? [...new Set(saved.filter(char => typeof char === 'string' && emojiEntry(char)))].slice(0, 24) : []
  } catch { return [] }
}

export default {
  name: 'EmojiPicker',
  components: { Icon },
  props: { reaction: Boolean },
  emits: ['select', 'close'],
  data() { return { query: '', recents: loadRecents(), activeId: 'recent', preview: null, tabStop: null } },
  computed: {
    sections() {
      const recent = this.recents.length ? this.recents : REACTION_EMOJIS
      const all = [{ id: 'recent', title: this.recents.length ? 'Recently used' : 'Quick reactions', emojis: recent.map(emojiEntry).filter(Boolean) }, ...EMOJI_CATEGORIES]
      const query = normalizeQuery(this.query)
      if (!query) return all
      // Search is about the best match, regardless of its shelf or recent use.
      const found = new Map()
      for (const section of all) {
        const titleMatches = scoreTitle(section.title, query) || scoreTitle(this.$t(section.title).toLowerCase(), this.query.trim().toLowerCase())
        for (const entry of section.emojis) {
          const score = Math.max(scoreEmoji({ ...entry, keywords: [...entry.keywords, entry.char] }, query), titleMatches ? 1 : 0)
          if (score && (!found.has(entry.char) || found.get(entry.char).score < score)) found.set(entry.char, { entry, score })
        }
      }
      const emojis = [...found.values()].sort((a, b) => b.score - a.score).map(({ entry }) => entry)
      return emojis.length ? [{ id: 'results', title: 'Search results', emojis }] : []
    }
  },
  watch: {
    query() {
      this.preview = null
      this.tabStop = null
      this.$nextTick(() => {
        if (this.$refs.scroller) this.$refs.scroller.scrollTop = 0
        this.activeId = this.sections[0]?.id || ''
      })
    }
  },
  mounted() {
    // On phones, opening the picker must not immediately bring up the keyboard.
    if (window.matchMedia('(min-width: 1024px)').matches) this.$refs.search.focus({ preventScroll: true })
  },
  methods: {
    pick(entry) {
      this.preview = entry
      this.recents = [entry.char, ...this.recents.filter(char => char !== entry.char)].slice(0, 24)
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents)) } catch { /* optional */ }
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
.emoji-picker { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-card); color: var(--text-primary); font-family: 'Manrope', sans-serif; }
.emoji-picker__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 4px 20px; }
.emoji-picker__header h2 { margin: 0; font-size: 1.125rem; font-weight: 750; line-height: 1.5; }
.emoji-picker__button, .emoji-picker__category { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 14px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.emoji-picker__button:hover, .emoji-picker__category:hover { background: var(--bg-input); }
.emoji-picker__search { display: flex; align-items: center; gap: 9px; margin: 8px 16px 14px; padding: 0 12px; min-height: 46px; border: 1px solid var(--border-card); border-radius: 24px; background: var(--bg-input); color: var(--text-secondary); }
.emoji-picker__search:focus-within { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
.emoji-picker__search input { min-width: 0; width: 100%; min-height: 44px; background: transparent; border: 0; outline: 0; color: var(--text-primary); font: inherit; font-size: 1rem; }
.emoji-picker__search input::placeholder { color: var(--text-secondary); }
.emoji-picker__body { display: flex; flex: 1; min-height: 0; }
.emoji-picker__rail { display: flex; flex-direction: column; gap: 3px; padding: 0 5px 8px; overflow-y: auto; scrollbar-width: none; flex-shrink: 0; }
.emoji-picker__category { font-size: 21px; position: relative; }
.emoji-picker__category[aria-current='true'] { background: var(--brand-accent-soft); color: var(--text-primary); }
.emoji-picker__category[aria-current='true']::before { content: ''; position: absolute; left: 0; height: 18px; width: 3px; border-radius: 3px; background: var(--brand-accent); }
.emoji-picker__list { flex: 1; min-width: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 0 12px 16px 4px; }
.emoji-picker__list h3 { position: sticky; top: 0; z-index: 1; background: var(--bg-card); margin: 0; padding: 10px 4px 7px; font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); line-height: 1.5; }
.emoji-picker__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 2px; }
.emoji-picker__cell { display: grid; place-items: center; min-width: 44px; min-height: 46px; padding: 0; border: 0; border-radius: 13px; background: transparent; cursor: pointer; font-size: 26px; line-height: 1; }
.emoji-picker__cell:hover { background: var(--bg-input); transform: scale(1.08); }
.emoji-picker__cell:active { transform: scale(.96); }
.emoji-picker__cell:focus-visible, .emoji-picker__category:focus-visible, .emoji-picker__button:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: -2px; background: var(--bg-input); }
.emoji-picker__preview { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 18px max(10px, var(--safe-bottom, 0px)); border-top: 1px solid var(--border-card); }
.emoji-picker__preview > span:first-child { font-size: 30px; flex-shrink: 0; }
.emoji-picker__preview > span:last-child { font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5; }
.emoji-picker__empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 36px 18px; text-align: center; }
.emoji-picker__empty > span { font-size: 36px; }
.emoji-picker__empty strong { font-size: .9375rem; }
.emoji-picker__empty p { color: var(--text-secondary); font-size: .8125rem; margin: 0; }
@media (prefers-reduced-motion: reduce) { .emoji-picker__cell:hover, .emoji-picker__cell:active { transform: none; } }
</style>
