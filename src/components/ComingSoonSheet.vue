<template>
  <q-dialog
    :model-value="modelValue"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <q-card class="coming-soon-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <q-card-section class="coming-soon-header">
        <!-- The thing that is coming, shown as itself: a partner mark, an
             icon, whatever the caller passes. -->
        <div class="coming-soon-brand"><slot name="brand" /></div>
        <div class="coming-soon-title">{{ title }}</div>
        <div class="coming-soon-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          {{ message }}
        </div>
      </q-card-section>
      <q-card-actions class="coming-soon-actions">
        <q-btn unelevated no-caps :label="$t('Got it')" class="coming-soon-btn" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
/**
 * A door that is on the page before the room behind it exists. Says what
 * is coming in one line, then gets out of the way. One component so every
 * "under construction" entry in the app reads the same.
 */
export default {
  name: 'ComingSoonSheet',
  props: {
    modelValue: { type: Boolean, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
  },
  emits: ['update:modelValue'],
};
</script>

<style scoped>
.coming-soon-card {
  width: 100%;
  max-width: 360px;
  border-radius: var(--radius-md, 16px);
  padding: 8px;
}

.coming-soon-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 20px 16px 8px;
}

.coming-soon-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  overflow: hidden;
}

.coming-soon-brand :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.coming-soon-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}

.coming-soon-message {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  line-height: 1.4;
}

.coming-soon-actions {
  padding: 8px 16px 16px;
}

.coming-soon-btn {
  flex: 1;
  background: var(--brand-accent);
  color: #0E1F17;
  border-radius: 12px;
  font-weight: 700;
  font-family: 'Manrope', sans-serif;
}
</style>
