<!--
  ConnectWalletChooser: the first step of "Connect a wallet". One short
  list from utils/connectWallets, each row named after the wallet and what
  the person does there. Wallets on their way (`soon`) sit apart, as
  information: not a choice yet, so a tap only says what it is.
-->
<template>
  <FormSheetStep :title="$t('Connect a wallet')" :subtitle="$t('Use a wallet you already have, here in BuhoGO.')" back @back="$emit('back')">
    <template #icon>
      <Icon icon="tabler:plug-connected" width="26" height="26" />
    </template>

    <div class="iform-group">
      <button
        v-for="wallet in wallets"
        :key="wallet.id"
        type="button"
        class="iform-line connect-choice"
        :data-audit="`connect-${wallet.id}`"
        @click="$emit('choose', wallet.id)"
      >
        <span class="iform-line-tile connect-choice__tile" aria-hidden="true">
          <ConnectWalletMark :wallet="wallet" />
        </span>
        <span class="iform-line-label">{{ nameOf(wallet) }}<small>{{ $t(wallet.subtitle) }}</small></span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" :aria-hidden="true" />
      </button>
    </div>

    <div v-for="wallet in upcoming" :key="wallet.id" class="iform-group connect-soon">
      <button
        type="button"
        class="iform-line"
        :aria-expanded="open === wallet.id"
        :aria-controls="`connect-about-${wallet.id}`"
        :data-audit="`connect-${wallet.id}`"
        @click="open = open === wallet.id ? '' : wallet.id"
      >
        <span class="iform-line-tile connect-choice__tile" aria-hidden="true">
          <ConnectWalletMark :wallet="wallet" />
        </span>
        <span class="iform-line-label">{{ nameOf(wallet) }}</span>
        <span class="connect-soon__label">{{ $t('Coming soon') }}</span>
        <Icon icon="tabler:chevron-down" width="16" height="16" class="iform-line-chevron connect-soon__chevron" :class="{ 'is-open': open === wallet.id }" :aria-hidden="true" />
      </button>
      <p v-show="open === wallet.id" :id="`connect-about-${wallet.id}`" class="connect-soon__about">
        {{ $t(wallet.about) }}
      </p>
    </div>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import ConnectWalletMark from './ConnectWalletMark.vue';
import { availableWallets, upcomingWallets } from '../../utils/connectWallets.js';

export default {
  name: 'ConnectWalletChooser',
  components: { FormSheetStep, ConnectWalletMark },
  emits: ['choose', 'back'],
  data() {
    return {
      wallets: availableWallets(),
      upcoming: upcomingWallets(),
      // The upcoming wallet whose note is open.
      open: '',
    };
  },
  methods: {
    nameOf(wallet) { return wallet.name || this.$t(wallet.nameKey); },
  },
};
</script>

<style scoped>
.connect-choice__tile {
  background: #fff;
  border: 1px solid var(--border-card);
  color: #1A1A1C;
}
.connect-soon {
  margin-top: 14px;
}
.connect-soon .iform-line-label {
  color: var(--text-secondary);
}
.connect-soon__label {
  flex-shrink: 0;
  font: 600 12.5px 'Manrope', sans-serif;
  color: var(--text-muted);
}
.connect-soon__chevron {
  transition: transform 0.2s ease;
}
.connect-soon__chevron.is-open {
  transform: rotate(180deg);
}
.connect-soon__about {
  margin: 0;
  padding: 0 14px 13px 58px;
  font: 500 13px/1.45 'Manrope', sans-serif;
  color: var(--text-secondary);
}
@media (prefers-reduced-motion: reduce) {
  .connect-soon__chevron { transition: none; }
}
</style>
