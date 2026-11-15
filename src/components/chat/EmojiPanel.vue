<!--
  EmojiPanel
  Where the emoji picker sits: docked beside the chat on a wide window, a
  bottom sheet over it otherwise. The list itself is EmojiPicker.vue, loaded
  the first time the panel opens.

    - `docked` comes from the page (composables/useEmojiPicker.js decides it,
      so the page, the panel and the picker never disagree).
    - `v-model` is open or closed; `sessionKey` changes with every opening, so
      the picker always starts with an empty search.
    - `closed` fires once the panel has left the screen (after the sheet's
      animation): the moment to hand focus back.

  Escape: the sheet is a dialog and closes itself; for the dock the page
  listens, so Escape also works while the caret is in the message field.
-->
<template>
  <aside v-if="docked && modelValue" id="chat-emoji-panel" class="emoji-panel" :aria-label="$t('Emoji')">
    <EmojiPicker
      :key="sessionKey"
      :reaction="reaction"
      :fine-pointer="finePointer"
      @select="$emit('select', $event)"
      @close="close"
    />
  </aside>
  <q-dialog
    v-else-if="!docked"
    :model-value="modelValue"
    position="bottom"
    no-refocus
    @hide="$emit('closed')"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div id="chat-emoji-panel" class="emoji-sheet">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <EmojiPicker
        v-if="modelValue"
        :key="sessionKey"
        :reaction="reaction"
        :fine-pointer="finePointer"
        @select="$emit('select', $event)"
        @close="close"
      />
    </div>
  </q-dialog>
</template>

<script>
import { defineAsyncComponent } from 'vue'
import { hasFinePointer } from '../../composables/useEmojiPicker.js'
import './chatTokens.css'

export default {
  name: 'EmojiPanel',
  components: {
    // About 500 emoji and their search: only needed once someone opens the picker.
    EmojiPicker: defineAsyncComponent(() => import('./EmojiPicker.vue'))
  },
  props: {
    modelValue: { type: Boolean, default: false },
    /** Beside the chat (true) or a bottom sheet over it (false). */
    docked: { type: Boolean, default: false },
    /** The picker is open for a reaction, not for the draft. */
    reaction: { type: Boolean, default: false },
    sessionKey: { type: Number, default: 0 }
  },
  emits: ['update:modelValue', 'select', 'closed'],
  data() {
    return { finePointer: hasFinePointer() }
  },
  watch: {
    // The dock has no animation to wait for: it is gone with the next render.
    modelValue(open) {
      if (!open && this.docked) this.$nextTick(() => this.$emit('closed'))
    }
  },
  methods: {
    close() { this.$emit('update:modelValue', false) }
  }
}
</script>

<style scoped>
.emoji-panel {
  flex: 0 0 360px;
  width: 360px;
  min-height: 0;
  display: flex;
  margin: 12px 12px 12px 0;
  overflow: hidden;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
}

.emoji-sheet {
  width: 100%;
  max-width: 520px;
  height: min(580px, 75dvh);
  max-height: calc(100dvh - var(--safe-top, 0px) - 8px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border-top: 1px solid var(--border-card);
  background: var(--bg-card);
}
</style>
