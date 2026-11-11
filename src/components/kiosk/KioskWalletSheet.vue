<!--
  KioskWalletSheet: where the register's payments go (issue #449). Every
  wallet is listed; one that cannot take kiosk payments says why and cannot
  be picked. A tap picks a wallet and closes the sheet.

  `options`: [{ id, name, type, caption, blocked }], built by the page from
  utils/walletCapabilities (kioskWalletBlocker).
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <q-card class="kws-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="form-sheet-grabber" aria-hidden="true"></div>
      <header class="form-sheet-header">
        <span aria-hidden="true"></span>
        <h2 class="form-sheet-title">{{ $t('Receiving Wallet') }}</h2>
        <button type="button" class="form-sheet-cancel kws-cancel" @click="$emit('update:modelValue', false)">{{ $t('Cancel') }}</button>
      </header>
      <div class="kws-body">
        <IdentityGroup :footer="$t('Every sale at the register goes to this wallet.')">
          <IdentityRow
            v-for="option in options"
            :key="option.id"
            :label="option.name"
            :caption="option.caption"
            :interactive="!option.blocked"
            :chevron="false"
            :class="{ 'kws-blocked': option.blocked }"
            @click="pick(option.id)"
          >
            <template #leading>
              <span class="kws-glyph" aria-hidden="true"><WalletBrandMark :type="option.type" :size="16" color="currentColor" /></span>
            </template>
            <template #trailing>
              <Icon v-if="option.id === selected" icon="tabler:check" width="20" height="20" class="kws-check" :aria-label="$t('Selected')" :aria-hidden="false" />
            </template>
          </IdentityRow>
        </IdentityGroup>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityGroup from '../identity/IdentityGroup.vue';
import IdentityRow from '../identity/IdentityRow.vue';
import WalletBrandMark from '../WalletBrandMark.vue';

export default {
  name: 'KioskWalletSheet',
  components: { Icon, IdentityGroup, IdentityRow, WalletBrandMark },
  props: {
    modelValue: { type: Boolean, default: false },
    options: { type: Array, required: true },
    selected: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'select'],
  methods: {
    pick(id) {
      this.$emit('select', id);
      this.$emit('update:modelValue', false);
    },
  },
};
</script>

<style scoped>
.kws-card { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; }
.kws-cancel { justify-self: end; }
/* The body pads the bottom: Quasar's own bottom-dialog padding wins over the card's. */
.kws-body { padding: 8px 16px max(20px, var(--safe-bottom, 0px)); }
.kws-glyph { width: 30px; height: 30px; flex: none; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg-input); color: var(--text-primary); }
.kws-check { flex: none; color: var(--color-green); }
.kws-blocked :deep(.id-row-label),
.kws-blocked .kws-glyph { opacity: .45; }
</style>
