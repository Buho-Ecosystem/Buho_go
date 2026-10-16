<!--
  FormSheetStep: one step of a setup form sheet (connect a wallet, name
  it, give it an address, explain a problem). It draws the chrome every
  step shares, so a step only describes its own content:

    top bar  — glass Back on the left (when `back`), a text action such as
               "Not now" on the right (when `skipLabel`)
    hero     — tile with the step's icon and an optional status badge, the
               serif title and one short subtitle
    body     — the default slot, scrolling when it has to
    footer   — the `footer` slot: the step's one primary action

  The parent provides the sheet itself (.iform-sheet, src/css/app.css).
-->
<template>
  <header class="iform-sheet-top">
    <q-btn v-if="back" flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="$emit('back')">
      <Icon icon="tabler:chevron-left" width="20" height="20" />
    </q-btn>
    <div v-else class="iform-sheet-spacer"></div>
    <div class="iform-sheet-title"></div>
    <button v-if="skipLabel" type="button" class="form-sheet-step__skip" @click="$emit('skip')">{{ skipLabel }}</button>
    <div v-else class="iform-sheet-spacer"></div>
  </header>

  <div class="iform-sheet-scroll">
    <div class="iform-body">
      <div class="iform-hero">
        <div class="iform-tile form-sheet-step__tile">
          <slot name="icon" />
          <span v-if="badge" class="form-sheet-step__badge" :class="`is-${badge}`" aria-hidden="true">
            <Icon :icon="badge === 'good' ? 'tabler:check' : 'tabler:exclamation-mark'" width="11" height="11" />
          </span>
        </div>
        <h2 :id="titleId" class="iform-hero-title form-sheet-step__title">{{ title }}</h2>
        <p v-if="subtitle" class="iform-hero-sub form-sheet-step__sub">{{ subtitle }}</p>
      </div>
      <slot />
    </div>
  </div>

  <footer class="iform-sheet-footer">
    <slot name="footer" />
  </footer>
</template>

<script>
export default {
  name: 'FormSheetStep',
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    /** 'good' (green check) or 'warn' (amber mark) on the hero tile. */
    badge: { type: String, default: '', validator: (v) => ['', 'good', 'warn'].includes(v) },
    back: { type: Boolean, default: false },
    skipLabel: { type: String, default: '' },
    /** Lets the surrounding sheet point aria-labelledby at the title. */
    titleId: { type: String, default: undefined },
  },
  emits: ['back', 'skip'],
};
</script>

<style scoped>
.form-sheet-step__skip {
  flex-shrink: 0;
  min-height: 40px;
  padding: 0 6px;
  border: 0;
  background: none;
  color: var(--brand-accent-text);
  font: 600 15px 'Manrope', sans-serif;
  cursor: pointer;
}
.form-sheet-step__skip:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 2px;
  border-radius: 8px;
}
.form-sheet-step__tile {
  position: relative;
  color: var(--text-secondary);
}
.form-sheet-step__badge {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  border: 3px solid var(--bg-card);
}
.form-sheet-step__badge.is-good { background: #059573; }
.form-sheet-step__badge.is-warn { background: #B7791F; }
.form-sheet-step__title {
  margin: 12px 0 0;
  text-wrap: balance;
}
.form-sheet-step__sub {
  margin: 5px 0 0;
  text-wrap: balance;
}
</style>
