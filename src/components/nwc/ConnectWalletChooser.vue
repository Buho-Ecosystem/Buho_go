<!--
  ConnectWalletChooser: the first step of "Connect a wallet". One short
  list, each row named after the wallet and what the person does there:
  the wallets with a one-tap approval first, then LNbits, then any other
  wallet. BuhoHub sits apart, as information: it is not a choice yet, so a
  tap only says what it is.
-->
<template>
  <FormSheetStep :title="$t('Connect a wallet')" :subtitle="$t('Use a wallet you already have, here in BuhoGO.')" back @back="$emit('back')">
    <template #icon>
      <Icon icon="tabler:plug-connected" width="26" height="26" />
    </template>

    <div class="iform-group">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="iform-line connect-choice"
        :data-audit="`connect-${option.id}`"
        @click="$emit('choose', option.id)"
      >
        <span class="iform-line-tile connect-choice__tile" aria-hidden="true">
          <ConnectWalletMark :wallet="option.id" />
        </span>
        <span class="iform-line-label">{{ option.title }}<small>{{ option.subtitle }}</small></span>
        <Icon icon="tabler:chevron-right" width="18" height="18" class="iform-line-chevron" :aria-hidden="true" />
      </button>
    </div>

    <div class="iform-group connect-soon">
      <button
        type="button"
        class="iform-line"
        :aria-expanded="soonOpen"
        aria-controls="connect-buhohub-about"
        data-audit="connect-buhohub"
        @click="soonOpen = !soonOpen"
      >
        <span class="iform-line-tile connect-choice__tile" aria-hidden="true">
          <ConnectWalletMark wallet="buhohub" />
        </span>
        <span class="iform-line-label">BuhoHub</span>
        <span class="connect-soon__label">{{ $t('Coming soon') }}</span>
        <Icon icon="tabler:chevron-down" width="16" height="16" class="iform-line-chevron connect-soon__chevron" :class="{ 'is-open': soonOpen }" :aria-hidden="true" />
      </button>
      <p v-show="soonOpen" id="connect-buhohub-about" class="connect-soon__about">
        {{ $t('The home base behind BuhoGO is on its way. Once it opens, you connect it here.') }}
      </p>
    </div>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import ConnectWalletMark from './ConnectWalletMark.vue';

export default {
  name: 'ConnectWalletChooser',
  components: { FormSheetStep, ConnectWalletMark },
  emits: ['choose', 'back'],
  data() {
    return { soonOpen: false };
  },
  computed: {
    options() {
      return [
        { id: 'albyhub', title: 'Alby Hub', subtitle: this.$t('Approve BuhoGO in your Hub') },
        { id: 'coinos', title: 'Coinos', subtitle: this.$t('Approve BuhoGO in Coinos') },
        { id: 'lnbits', title: 'LNbits', subtitle: this.$t('Server address and key') },
        { id: 'other', title: this.$t('Another wallet'), subtitle: this.$t('Scan, paste or show a code') },
      ];
    },
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
