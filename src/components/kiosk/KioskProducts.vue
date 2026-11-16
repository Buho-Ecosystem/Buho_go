<template>
  <section class="kiosk-products">
    <div v-if="products.length && categories.length" class="kiosk-products__categories" role="group" :aria-label="$t('Product categories')">
      <button type="button" :class="{ 'is-selected': !category }" :aria-pressed="!category" @click="$emit('update:category', '')">{{ $t('All') }}</button>
      <button v-for="name in categories" :key="name" type="button" :class="{ 'is-selected': category === name }" :aria-pressed="category === name" @click="$emit('update:category', name)">{{ name }}</button>
    </div>
    <q-virtual-scroll v-if="filtered.length" ref="list" class="kiosk-products__list" role="region" :aria-label="$t('Products')" :items="filtered" :virtual-scroll-item-size="68" :virtual-scroll-slice-size="20" @scroll.passive="$emit('scroll', $event.target.scrollTop)">
      <template #default="{ item: product }">
        <button
          :key="product.id"
          type="button"
          class="kiosk-products__product"
          :class="{ 'is-in-basket': !manage && quantity(product.id) > 0 }"
          :disabled="disabled"
          :aria-label="productLabel(product)"
          @click="$emit(manage ? 'edit' : 'add', product)"
        >
          <span class="kiosk-products__symbol" aria-hidden="true"><Icon icon="tabler:package" width="25" height="25" /></span>
          <span class="kiosk-products__name"><strong>{{ product.name }}</strong><small v-if="manage && product.category">{{ product.category }}</small></span>
          <span class="kiosk-products__price">{{ formatPrice(product) }}</span>
          <Icon v-if="manage" class="kiosk-products__chevron" icon="tabler:chevron-right" width="17" height="17" />
          <span v-else class="kiosk-products__quantity" aria-hidden="true"><template v-if="quantity(product.id)">{{ quantity(product.id) > 99 ? '99+' : quantity(product.id) }}</template><Icon v-else icon="tabler:plus" width="15" height="15" /></span>
        </button>
      </template>
    </q-virtual-scroll>
    <div v-else ref="emptyList" class="kiosk-products__list" role="region" :aria-label="$t('Products')" tabindex="0">
      <div v-if="products.length" class="kiosk-products__empty">
        <h2>{{ $t('No matching products') }}</h2>
        <p>{{ $t('Try another name or category.') }}</p>
        <button type="button" @click="$emit('clear-filters')">{{ $t('Show all products') }}</button>
      </div>
      <div v-else class="kiosk-products__empty">
        <Icon icon="tabler:shopping-bag" width="34" height="34" />
        <h2>{{ $t('Your products go here') }}</h2>
        <p>{{ $t('Enter an amount to start selling. Add products whenever you want.') }}</p>
        <button v-if="emptyActionLabel" type="button" @click="$emit('manage')">{{ emptyActionLabel }}</button>
      </div>
    </div>
    <span class="kiosk-products__sr" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</span>
  </section>
</template>

<script>
import { Icon } from '@iconify/vue';

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

/** Product prices and basket state come from the parent; this component never changes money. */
export default {
  name: 'KioskProducts',
  components: { Icon },
  props: {
    /** [{ id, name, category, priceMinor, currency }] in the merchant's stable order. */
    products: { type: Array, default: () => [] },
    categories: { type: Array, default: () => [] },
    quantities: { type: Object, default: () => ({}) },
    search: { type: String, default: '' },
    category: { type: String, default: '' },
    formatPrice: { type: Function, required: true },
    manage: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    scrollTop: { type: Number, default: 0 },
    emptyActionLabel: { type: String, default: '' },
  },
  /** add/edit carry the whole product object; the parent checks and commits the operation. */
  emits: ['add', 'edit', 'manage', 'update:category', 'clear-filters', 'scroll'],
  data() {
    return { announcement: '' };
  },
  computed: {
    filtered() {
      const terms = normalize(this.search).trim().split(/\s+/).filter(Boolean);
      return this.products.filter((product) => (!this.category || product.category === this.category) && terms.every((term) => normalize(`${product.name} ${product.category || ''}`).includes(term)));
    },
    basketCount() {
      return Object.values(this.quantities).reduce((sum, value) => sum + (Number(value) || 0), 0);
    },
  },
  watch: {
    search() { this.scrollTo(0); },
    category() { this.scrollTo(0); },
    scrollTop(value) { this.scrollTo(value); },
    basketCount(value, old) {
      if (value !== old && !this.manage) this.announcement = this.$t('{n} items in basket', { n: value });
    },
  },
  mounted() { this.scrollTo(this.scrollTop); },
  methods: {
    quantity(id) { return Math.max(0, Number(this.quantities[id]) || 0); },
    productLabel(product) {
      if (this.manage) return this.$t('Edit {name}', { name: product.name });
      const label = this.$t('Add {name}, {price}', { name: product.name, price: this.formatPrice(product) });
      return this.quantity(product.id) ? `${label}. ${this.$t('{n} in basket', { n: this.quantity(product.id) })}` : label;
    },
    listElement() { return this.$refs.list?.$el || this.$refs.emptyList; },
    scrollTo(value) { const list = this.listElement(); if (list) list.scrollTop = Math.max(0, value || 0); },
    focusList() { this.listElement()?.focus({ preventScroll: true }); },
    getScrollPosition() { return this.listElement()?.scrollTop || 0; },
  },
};
</script>

<style scoped>
.kiosk-products { display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%; overflow: hidden; }
.kiosk-products__categories { display: flex; align-items: center; gap: 4px; flex: none; min-width: 0; padding: 0 16px 7px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }
.kiosk-products__categories button { flex: none; min-height: 44px; max-width: 220px; padding: 9px 13px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--text-secondary); font: 650 12px/1.4 'Manrope', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.kiosk-products__categories .is-selected { color: var(--brand-accent-text); background: rgba(5,149,115,.08); border-color: rgba(5,149,115,.2); }
.kiosk-products__list { flex: 1; min-height: 0; margin: 0 16px; padding-bottom: 8px; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain; scrollbar-width: thin; }
.kiosk-products__product { display: grid; grid-template-columns: 32px minmax(0,1fr) auto 28px; align-items: center; gap: 10px; width: 100%; min-height: 68px; padding: 12px 0; border: 0; border-bottom: 1px solid var(--border-card); border-radius: 0; text-align: left; background: transparent; color: var(--text-primary); cursor: pointer; }
.kiosk-products__product:first-child { border-top: 1px solid var(--border-card); }
.kiosk-products__product:disabled { opacity: .5; cursor: default; }
.kiosk-products__product:active:not(:disabled) { background: var(--bg-input); }
.kiosk-products__symbol { display: grid; place-items: center; width: 32px; height: 36px; color: var(--text-secondary); }
.kiosk-products__name { min-width: 0; }
.kiosk-products__name strong { display: block; color: var(--text-primary); font: 650 14px/1.4 'Manrope', sans-serif; overflow-wrap: anywhere; }
.kiosk-products__name small { display: block; margin-top: 3px; color: var(--text-secondary); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
.kiosk-products__price { color: var(--text-primary); font: 650 13px/1.4 'Manrope', sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
.kiosk-products__quantity { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--bg-input); color: var(--text-secondary); font: 750 11px/1 'Manrope', sans-serif; }
.is-in-basket .kiosk-products__quantity { background: rgba(5,149,115,.1); color: var(--brand-accent-text); }
.is-in-basket .kiosk-products__symbol { color: var(--brand-accent-text); }
.kiosk-products__chevron { color: var(--text-secondary); }
.kiosk-products__empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 32px 14px 20px; color: var(--text-secondary); text-align: center; }
.kiosk-products__empty h2 { margin: 0; color: var(--text-primary); font: 750 17px/1.3 'Manrope', sans-serif; }
.kiosk-products__empty p { max-width: 270px; margin: 0; font-size: 13px; line-height: 1.6; }
.kiosk-products__empty button { min-height: 44px; margin-top: 3px; padding: 8px 10px; border: 0; background: transparent; color: var(--brand-accent-text); font: 650 13px/1.4 'Manrope', sans-serif; cursor: pointer; }
.kiosk-products button:focus-visible, .kiosk-products__list:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: -2px; }
.kiosk-products__sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media(max-width:350px) { .kiosk-products__product { grid-template-columns: 28px minmax(0,1fr) auto 26px; gap: 8px; } .kiosk-products__name strong { font-size: 13px; } .kiosk-products__price { font-size: 12px; } .kiosk-products__quantity { width: 26px; height: 26px; } }
</style>
