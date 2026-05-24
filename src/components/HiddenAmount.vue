<template>
  <!--
    Privacy gate for any balance / aggregate display.

    Wraps the formatted amount in a tiny span that swaps to a
    fixed-length bullet placeholder when `walletStore.balanceHidden`
    is true. Reads the store directly so callers don't have to wire
    a prop chain through every parent — just drop this around the
    amount and it does the right thing globally.

    Use cases:
      • Wallet hero balance        — wrap the full formatted number.
      • Wallet switcher rows       — wrap each per-wallet balance.
      • Settings switcher captions — wrap each per-wallet caption.
      • Manage Wallets totals      — wrap each row + total stat.
      • Transaction History stats  — wrap Net / Sent / Received.

    Do NOT use for per-payment amounts inside action flows (send,
    receive, payment confirmation). Those are scoped to a specific
    action the user is actively taking; hiding them would break
    the flow ("you're about to send ••••?").

    Props:
      placeholder ─ override the bullet text (rare; the default
                    "••••" reads as universal "hidden" everywhere).
      withUnit    ─ true to keep a unit suffix when hidden. Pass the
                    unit via the `unit` slot or `unit` prop. Off by
                    default so the placeholder reveals zero info.
  -->
  <span class="hidden-amount" :data-hidden="hidden ? 'true' : 'false'">
    <template v-if="hidden">
      <span class="hidden-amount-placeholder">{{ placeholder }}</span>
      <span v-if="withUnit && (unit || $slots.unit)" class="hidden-amount-unit">
        <slot name="unit">{{ unit }}</slot>
      </span>
    </template>
    <template v-else>
      <slot />
    </template>
  </span>
</template>

<script>
import { useWalletStore } from '../stores/wallet';

export default {
  name: 'HiddenAmount',
  props: {
    placeholder: { type: String, default: '••••' },
    withUnit: { type: Boolean, default: false },
    unit: { type: String, default: '' },
  },
  setup() {
    const wallet = useWalletStore();
    return { wallet };
  },
  computed: {
    hidden() {
      return this.wallet.balanceHidden === true;
    },
  },
};
</script>

<style scoped>
.hidden-amount {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2em;
  /* Inherit colour / font from the parent so the placeholder reads
     as a styled substitution, not a separate widget. */
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
}

.hidden-amount-placeholder {
  /* Use a slightly heavier letter-spacing so the bullets look like
     intentional "redacted" glyphs rather than a typo. */
  letter-spacing: 0.18em;
  font-feature-settings: 'tnum';
}

.hidden-amount-unit {
  opacity: 0.7;
  font-size: 0.85em;
}
</style>
