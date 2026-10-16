<!--
  SparkStatusLine: why the active Spark wallet cannot reach Spark, said in
  one written line under the balance (#381). "No internet connection",
  "Spark can't be reached" or "Spark unreachable since Tuesday". Tapping it
  opens SparkStatusSheet: what happened, that the money is safe, what to
  try. Nothing shows while Spark answers, and there is nothing to dismiss:
  the line leaves on its own once Spark is back.
-->
<template>
  <button
    v-if="line"
    type="button"
    class="spark-status-line"
    data-audit="spark-status-line"
    @click="open = true"
  >
    <Icon :icon="line.icon" width="16" height="16" class="spark-status-line__icon" aria-hidden="true" />
    <span class="spark-status-line__text">{{ line.text }}</span>
    <Icon icon="tabler:chevron-right" width="14" height="14" class="spark-status-line__chevron" aria-hidden="true" />
  </button>

  <SparkStatusSheet v-model="open" :state="state" :wallet-id="walletId" />
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import SparkStatusSheet from './SparkStatusSheet.vue'
import { useSparkReachability } from '../../composables/useSparkReachability.js'
import { LEVEL } from '../../utils/sparkReachability.js'
import { relativeDay } from '../../composables/useExitFormat.js'

defineProps({
  /** The active Spark wallet, for the exit kit figures in the sheet. */
  walletId: { type: String, default: '' },
})

// vue-i18n runs in legacy mode, so useI18n() throws; use the instance's $t.
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)

const state = useSparkReachability()
const open = ref(false)

const line = computed(() => {
  const { level, since } = state.value
  if (level === LEVEL.NO_INTERNET) return { icon: 'tabler:wifi-off', text: t('No internet connection') }
  if (level === LEVEL.LONG_OUTAGE && since) {
    return { icon: 'tabler:cloud-off', text: t('Spark unreachable since {day}', { day: relativeDay(since, t, proxy.$i18n.locale) }) }
  }
  if (level >= LEVEL.UNREACHABLE) return { icon: 'tabler:cloud-off', text: t("Spark can't be reached") }
  return null
})

// The sheet closes by itself once Spark answers again. Watch the level, not
// the line: $t arrives after setup in legacy vue-i18n, so nothing that
// translates may run during setup.
watch(() => state.value.level, (level) => { if (level === LEVEL.NONE) open.value = false })
</script>

<style scoped>
.spark-status-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  max-width: 100%;
  min-height: 44px;
  margin: 2px auto 0;
  padding: 0 12px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font: 500 14px 'Manrope', sans-serif;
  cursor: pointer;
}
.spark-status-line__icon {
  flex-shrink: 0;
}
.spark-status-line__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spark-status-line__chevron {
  flex-shrink: 0;
  color: var(--text-muted, var(--text-secondary));
}
.spark-status-line:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
  border-radius: 10px;
}
</style>
