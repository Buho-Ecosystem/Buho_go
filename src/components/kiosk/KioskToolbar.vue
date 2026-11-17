<template>
  <header class="kiosk-toolbar" :aria-label="title">
    <template v-if="searchEnabled && searchOpen">
      <h1 class="kiosk-toolbar__sr">{{ title }}</h1>
      <form class="kiosk-toolbar__search" role="search" @submit.prevent="submitSearch">
        <Icon icon="tabler:search" width="19" height="19" />
        <input
          ref="searchInput"
          type="search"
          :value="searchValue"
          :placeholder="searchPlaceholder || $t('Search')"
          :aria-label="searchPlaceholder || $t('Search')"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          enterkeyhint="search"
          @input="$emit('update:searchValue', $event.target.value)"
          @keydown.esc.prevent="closeSearch"
        />
        <button v-if="searchValue" type="button" class="kiosk-toolbar__icon" :aria-label="$t('Clear search')" @click="clearSearch">
          <Icon icon="tabler:x" width="17" height="17" />
        </button>
      </form>
      <button type="button" class="kiosk-toolbar__cancel" @click="closeSearch">{{ $t('Cancel') }}</button>
    </template>
    <template v-else>
      <button v-if="showBack" type="button" class="kiosk-toolbar__icon kiosk-toolbar__back" :aria-label="backLabel || $t('Back')" @click="$emit('back')">
        <Icon icon="tabler:chevron-left" width="22" height="22" />
      </button>
      <h1 class="kiosk-toolbar__title">{{ title }}</h1>
      <div class="kiosk-toolbar__actions">
        <button
          v-if="searchEnabled"
          ref="searchButton"
          type="button"
          class="kiosk-toolbar__icon kiosk-toolbar__find"
          :aria-label="searchPlaceholder || $t('Search')"
          aria-expanded="false"
          @click="openSearch"
        >
          <Icon icon="tabler:search" width="21" height="21" />
        </button>
        <button
          v-for="action in actions"
          :key="action.id"
          type="button"
          class="kiosk-toolbar__icon"
          :disabled="action.disabled"
          :aria-label="action.label"
          :title="action.label"
          @click="$emit('action', action.id)"
        >
          <span v-if="action.id === 'more'" class="kiosk-toolbar__more">{{ $t('More') }}</span>
          <Icon v-else :icon="action.icon" width="21" height="21" />
        </button>
      </div>
    </template>
  </header>
</template>

<script>
import { Icon } from '@iconify/vue';

/** Owner navigation only. The parent owns routes, menu contents and search scope. */
export default {
  name: 'KioskToolbar',
  components: { Icon },
  props: {
    title: { type: String, required: true },
    showBack: { type: Boolean, default: true },
    backLabel: { type: String, default: '' },
    searchEnabled: { type: Boolean, default: false },
    searchOpen: { type: Boolean, default: false },
    searchValue: { type: String, default: '' },
    searchPlaceholder: { type: String, default: '' },
    /** [{ id, icon, label, disabled? }], labels must name the actual action. */
    actions: { type: Array, default: () => [] },
  },
  emits: ['back', 'action', 'update:searchOpen', 'update:searchValue', 'search-submit', 'search-cancel'],
  watch: {
    searchOpen(open) {
      if (open) this.$nextTick(() => this.$refs.searchInput?.focus({ preventScroll: true }));
    },
  },
  methods: {
    openSearch() {
      this.$emit('update:searchOpen', true);
    },
    closeSearch() {
      this.$emit('update:searchValue', '');
      this.$emit('update:searchOpen', false);
      this.$emit('search-cancel');
      this.$nextTick(() => this.$refs.searchButton?.focus({ preventScroll: true }));
    },
    clearSearch() {
      this.$emit('update:searchValue', '');
      this.$refs.searchInput?.focus({ preventScroll: true });
    },
    submitSearch() {
      this.$refs.searchInput?.blur();
      this.$emit('search-submit');
    },
  },
};
</script>

<style scoped>
.kiosk-toolbar { display: flex; align-items: center; gap: 4px; min-height: 52px; flex: 0 0 auto; width: 100%; padding: 0 12px; color: var(--text-primary); }
.kiosk-toolbar__icon { width: 44px; height: 44px; min-width: 44px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.kiosk-toolbar__back { color: var(--brand-accent-text); }
.kiosk-toolbar__title { flex: 1; min-width: 0; margin: 0; font: 750 21px/1.18 'Manrope', sans-serif; letter-spacing: -.025em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kiosk-toolbar__actions { display: flex; align-items: center; flex: none; }
.kiosk-toolbar__find { background: var(--bg-input); }
.kiosk-toolbar__more { font: 650 12px/1.3 'Manrope', sans-serif; }
.kiosk-toolbar__icon:disabled { opacity: .4; cursor: default; }
.kiosk-toolbar__icon:active:not(:disabled) { background: var(--bg-input); }
.kiosk-toolbar__search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 44px; padding-left: 12px; border: 1px solid var(--border-card); border-radius: 13px; background: var(--bg-input); color: var(--text-secondary); }
.kiosk-toolbar__search input { width: 100%; min-width: 0; height: 42px; padding: 8px 0; border: 0; outline: none; background: transparent; color: var(--text-primary); font: 500 16px/1.4 'Manrope', sans-serif; }
.kiosk-toolbar__search input::-webkit-search-cancel-button, .kiosk-toolbar__search input::-webkit-search-decoration { -webkit-appearance: none; appearance: none; }
.kiosk-toolbar__search:focus-within { border-color: var(--brand-accent-text); }
.kiosk-toolbar__cancel { min-height: 44px; padding: 8px 4px 8px 8px; border: 0; background: transparent; color: var(--brand-accent-text); font: 650 13px/1.3 'Manrope', sans-serif; cursor: pointer; }
.kiosk-toolbar button:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
.kiosk-toolbar__sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media(max-width: 350px) { .kiosk-toolbar { gap: 2px; padding-inline: 8px; } .kiosk-toolbar__title { font-size: 20px; } }
</style>
