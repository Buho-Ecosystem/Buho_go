<template>
  <q-dialog v-model="open" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
    <q-card class="identity-surface exit-how-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>
      <div class="sheet-head">
        <div class="sheet-title">{{ $t('How the emergency exit works') }}</div>
        <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>
      <div class="sheet-body exit-how-body">
        <div v-for="row in rows" :key="row.icon" class="exit-how-row">
          <span class="exit-how-icon"><Icon :icon="row.icon" width="20" height="20" /></span>
          <div class="exit-how-copy">
            <strong>{{ $t(row.title) }}</strong>
            <p>{{ $t(row.text) }}</p>
          </div>
        </div>
        <div class="exit-how-not">
          <span class="exit-how-kicker">{{ $t('What it is not') }}</span>
          <p>{{ $t('Not a backup of your recovery words. Not needed while Spark works: a normal withdrawal is faster and cheaper. Not a way to get money back that you sent to someone else.') }}</p>
        </div>
        <button type="button" class="btn-primary" @click="open = false">{{ $t('Done') }}</button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';

/**
 * The briefing card for the emergency exit: the essential facts and what the
 * feature is not, in plain words, reachable from the kit and the exit page.
 * Pictograms never stand alone; every row carries its sentence.
 */
export default {
  name: 'HowExitWorksSheet',
  components: { Icon },
  props: { modelValue: { type: Boolean, required: true } },
  emits: ['update:modelValue'],
  computed: {
    open: {
      get() { return this.modelValue; },
      set(value) { this.$emit('update:modelValue', value); },
    },
    rows() {
      return [
        { icon: 'tabler:fire-extinguisher', title: 'The kit is the key', text: 'BuhoGO keeps an encrypted kit for each Spark wallet and refreshes it after every payment. With the kit, the money can move to plain Bitcoin without Spark.' },
        { icon: 'tabler:key', title: 'Your words control the payout', text: "The default Bitcoin address is controlled by this wallet's same 12 recovery words. After the exit completes, restore them in a compatible Bitcoin wallet (BIP39, Native SegWit) to spend the funds." },
        { icon: 'tabler:address-book', title: 'Or choose another Bitcoin address', text: "Before sending, tap Change next to the payout amount to enter another on-chain Bitcoin address. The funds will then be controlled by the destination wallet." },
        { icon: 'tabler:coins', title: 'It costs fees', text: 'Fees are paid from a separate small on-chain amount. Small balances may cost more to move than they are worth; you see this before anything starts.' },
        { icon: 'tabler:calendar-time', title: 'It takes about two weeks', text: "Bitcoin's timelocks set the pace. Nothing runs while the app is closed, so open it once a day until it is done." },
      ];
    },
  },
};
</script>

<style scoped>
.exit-how-body { display: flex; flex-direction: column; gap: 18px; }
.exit-how-row { display: flex; gap: 14px; align-items: flex-start; }
.exit-how-icon { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 12px; background: var(--bg-input); color: var(--text-primary); }
.exit-how-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.exit-how-copy strong { font-size: 15px; font-weight: 700; line-height: 1.35; }
.exit-how-copy p, .exit-how-not p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-secondary); }
.exit-how-not { display: flex; flex-direction: column; gap: 6px; padding: 14px; border-radius: 12px; background: var(--bg-input); }
.exit-how-kicker { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
</style>
