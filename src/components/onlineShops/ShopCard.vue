<template>
  <button
    type="button"
    class="shop-card"
    :class="$q.dark.isActive ? 'shop-card-dark' : 'shop-card-light'"
    @click="$emit('select', shop)"
  >
    <ShopAvatar :shop="shop" :size="44" />

    <span class="shop-card-body">
      <span class="shop-card-line1">
        <span class="shop-card-name" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ shop.name }}</span>
        <Icon v-if="shop.verified" icon="tabler:rosette-discount-check-filled" width="15" height="15" class="shop-card-verified" :aria-label="$t('Verified')" />
        <Icon v-if="shop.payments && shop.payments.lightning" icon="tabler:bolt" width="14" height="14" class="shop-card-bolt" />
        <Icon v-else-if="shop.payments && shop.payments.onchain" icon="tabler:currency-bitcoin" width="14" height="14" class="shop-card-onchain" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'" />
      </span>
      <span class="shop-card-line2">
        <!-- The avatar already shows a specific country's flag; worldwide shops
             use a letter avatar, so a "Worldwide" pill carries that here. -->
        <span v-if="shop.country && shop.country.code === 'WW'" class="ww-pill" :class="$q.dark.isActive ? 'ww-pill-dark' : 'ww-pill-light'">{{ $t('Worldwide') }}</span>
        <span class="shop-card-desc" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ shop.description || shop.host }}</span>
      </span>
    </span>

    <Icon icon="tabler:chevron-right" width="18" height="18" class="shop-card-go" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-5'" />
  </button>
</template>

<script>
import { Icon } from '@iconify/vue';
import ShopAvatar from './ShopAvatar.vue';

/**
 * One shop row: avatar + name + payment/verified badges, then a second line
 * with country (flag, or a "Worldwide" pill) and a one-line description. The
 * whole row taps through to the detail sheet (the consent surface) — a card
 * never opens an external URL directly.
 */
export default {
  name: 'ShopCard',
  components: { Icon, ShopAvatar },
  props: { shop: { type: Object, required: true } },
  emits: ['select'],
};
</script>

<style scoped>
.shop-card {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 12px 14px; min-height: 72px; border: 0; border-radius: 16px;
  cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left;
  transition: transform 0.1s ease;
}
.shop-card-light { background: rgba(15, 23, 42, 0.04); box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.05); }
.shop-card-dark { background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.shop-card:active { transform: scale(0.99); }

.shop-card-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.shop-card-line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.shop-card-name { font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.shop-card-verified { color: #15a35b; flex-shrink: 0; }
body.body--dark .shop-card-verified { color: #2bd17f; }
.shop-card-bolt { color: #f7931a; flex-shrink: 0; }
.shop-card-onchain { flex-shrink: 0; }

.shop-card-line2 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ww-pill { font-family: 'Manrope', sans-serif; font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 999px; }
.ww-pill-light { background: rgba(15, 23, 42, 0.06); color: #475569; }
.ww-pill-dark { background: rgba(255, 255, 255, 0.08); color: #cbd5e1; }
.shop-card-desc { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.shop-card-go { flex-shrink: 0; opacity: 0.6; }

.item-label-light { color: #0f172a; }
.item-label-dark { color: #f8fafc; }
</style>
