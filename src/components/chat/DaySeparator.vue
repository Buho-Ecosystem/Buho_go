<!--
  DaySeparator
  "Today" / "Yesterday" / "12 October 2026" between the days of a thread.
  A real separator for assistive tech, named by its label.
-->
<template>
  <div class="day-separator" role="separator" :aria-label="label">
    <span class="day-separator__label" aria-hidden="true">{{ label }}</span>
  </div>
</template>

<script>
import { isSameDay } from './chatFormat.js'
import './chatTokens.css'

export default {
  name: 'DaySeparator',
  props: {
    /** Any moment of the day, unix seconds. */
    ts: { type: Number, required: true },
    /** "Now" in unix seconds; only tests and previews set it. */
    now: { type: Number, default: () => Date.now() / 1000 }
  },
  computed: {
    label() {
      if (isSameDay(this.ts, this.now)) return this.$t('Today')
      if (isSameDay(this.ts, this.now - 86400)) return this.$t('Yesterday')
      const date = new Date(this.ts * 1000)
      const sameYear = date.getFullYear() === new Date(this.now * 1000).getFullYear()
      return date.toLocaleDateString(this.$i18n?.locale, {
        day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' })
      })
    }
  }
}
</script>

<style scoped>
.day-separator {
  display: flex;
  justify-content: center;
  padding: 14px 0 6px;
  font-family: 'Manrope', sans-serif;
}
.day-separator__label {
  font-size: 0.6875rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
</style>
