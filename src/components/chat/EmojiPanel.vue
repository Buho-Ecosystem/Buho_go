<template>
  <aside v-if="modelValue && desktop" id="chat-emoji-panel" class="emoji-panel" :aria-label="$t('Emoji')" @keydown.esc.stop.prevent="close">
    <EmojiPicker :key="sessionKey" :reaction="reaction" @select="$emit('select', $event)" @close="close" />
  </aside>
  <q-dialog v-else-if="!desktop" :model-value="modelValue" position="bottom" no-refocus
    @hide="$emit('closed')" @update:model-value="$emit('update:modelValue', $event)">
    <div id="chat-emoji-panel" class="emoji-sheet">
      <EmojiPicker v-if="modelValue" :key="sessionKey" :reaction="reaction" @select="$emit('select', $event)" @close="close" />
    </div>
  </q-dialog>
</template>

<script>
import EmojiPicker from './EmojiPicker.vue'
export default {
  name: 'EmojiPanel',
  components: { EmojiPicker },
  props: { modelValue: Boolean, reaction: Boolean, sessionKey: { type: Number, default: 0 } },
  emits: ['update:modelValue', 'select', 'closed'],
  computed: { desktop() { return this.$q.screen.width >= 1024 } },
  watch: {
    modelValue(open) {
      if (!open && this.desktop) this.$nextTick(() => this.$emit('closed'))
    }
  },
  methods: { close() { this.$emit('update:modelValue', false) } }
}
</script>

<style scoped>
.emoji-panel { width: 360px; flex: 0 0 360px; min-height: 0; margin: 12px 12px 12px 0; overflow: hidden; border: 1px solid var(--border-card); border-radius: 24px; background: var(--bg-card); }
.emoji-sheet { width: 100%; max-width: 520px; height: min(580px, 75dvh); max-height: 100%; overflow: hidden; border-radius: 24px 24px 0 0 !important; background: var(--bg-card); }
</style>
