<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="mp-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <div class="sheet-header">
        <q-btn
          v-if="detail"
          flat round dense
          :aria-label="$t('Back')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          @click="detail = null"
        >
          <Icon icon="tabler:chevron-left" width="20" height="20" />
        </q-btn>
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ detail ? $t('Your purchase') : $t('My purchases') }}
        </div>
        <q-btn flat round dense :aria-label="$t('Close')" class="sheet-close-btn" :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <!-- Detail: reuse the success bodies in review mode -->
        <div v-if="detail" class="step-body">
          <SuccessEsim v-if="detail.kind === 'esim'" :receipt="detail" :animate="false" @done="detail = null" />
          <SuccessVpn v-else :receipt="detail" :animate="false" @done="detail = null" />
          <button type="button" class="remove-link" @click="removeCurrent">
            <Icon icon="tabler:trash" width="14" height="14" />
            <span>{{ $t('Remove from this list') }}</span>
          </button>
        </div>

        <!-- List -->
        <div v-else class="step-body">
          <div v-if="!store.hasPurchases" class="info-state" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <Icon icon="tabler:basket" width="24" height="24" />
            <span>{{ $t('Nothing here yet. Your eSIMs and VPNs will appear here after you buy.') }}</span>
          </div>

          <template v-else>
            <section v-if="store.esims.length" class="block">
              <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('eSIMs') }}</div>
              <button
                v-for="e in store.esims"
                :key="e.iccid"
                type="button"
                class="mp-row"
                :class="$q.dark.isActive ? 'mp-row-dark' : 'mp-row-light'"
                @click="openDetail(e, 'esim')"
              >
                <span class="row-flag">{{ e.flag || '📶' }}</span>
                <span class="row-meta">
                  <span class="row-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ e.countryName || $t('eSIM') }}</span>
                  <span class="row-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ e.planLabel || formatPlan(e) }}</span>
                </span>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="row-go" />
              </button>
            </section>

            <section v-if="store.vpns.length" class="block">
              <div class="block-title" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">{{ $t('VPN') }}</div>
              <button
                v-for="v in store.vpns"
                :key="v.publicKey"
                type="button"
                class="mp-row"
                :class="$q.dark.isActive ? 'mp-row-dark' : 'mp-row-light'"
                @click="openDetail(v, 'vpn')"
              >
                <span class="row-flag">{{ v.flag || '🛡️' }}</span>
                <span class="row-meta">
                  <span class="row-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">{{ v.countryName || $t('VPN') }}</span>
                  <span class="row-sub" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">{{ v.durationLabel || $t('WireGuard config') }}</span>
                </span>
                <Icon icon="tabler:chevron-right" width="18" height="18" class="row-go" />
              </button>
            </section>
          </template>
        </div>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useNadanadaPurchasesStore } from '../../stores/nadanadaPurchases';
import SuccessEsim from './SuccessEsim.vue';
import SuccessVpn from './SuccessVpn.vue';

/**
 * "My purchases" sheet. The device-local record is the only proof of a
 * nadanada purchase (no accounts), so this is the durable retrieval surface:
 * re-show an eSIM's install QR/codes or a VPN's config QR at any time. Reuses
 * the success bodies in review mode (no replay animation).
 */
export default {
  name: 'MyPurchases',
  components: { Icon, SuccessEsim, SuccessVpn },
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],

  setup() {
    const store = useNadanadaPurchasesStore();
    return { store };
  },

  data() {
    return { detail: null };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
  },

  watch: {
    open(v) { if (!v) this.detail = null; },
  },

  methods: {
    openDetail(record, kind) {
      this.detail = { ...record, kind };
    },
    formatPlan(e) {
      const parts = [];
      if (e.dataInGB != null) parts.push(`${e.dataInGB} GB`);
      if (e.durationInDays != null) parts.push(this.$t('{n} days', { n: e.durationInDays }));
      return parts.join(' · ');
    },
    removeCurrent() {
      if (!this.detail) return;
      if (this.detail.kind === 'esim') this.store.removeEsim(this.detail.iccid);
      else this.store.removeVpn(this.detail.publicKey);
      this.detail = null;
    },
  },
};
</script>

<style scoped>
.mp-sheet { width: 100%; max-width: 520px; border-top-left-radius: 22px; border-top-right-radius: 22px; overflow: hidden; padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; max-height: 90vh; max-height: 90dvh; }
.sheet-handle { display: flex; justify-content: center; padding: 8px 0 4px; flex-shrink: 0; }
.sheet-handle-bar-light, .sheet-handle-bar-dark { width: 36px; height: 4px; border-radius: 999px; display: block; }
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark { background: rgba(255, 255, 255, 0.22); }
.sheet-header { display: flex; align-items: center; padding: 4px 18px 8px; gap: 8px; flex-shrink: 0; }
.sheet-title { flex: 1 1 auto; font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; text-align: center; }
.sheet-close-btn { flex: 0 0 auto; }
.sheet-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.step-body { display: flex; flex-direction: column; gap: 16px; padding: 6px 18px 18px; }

.block { display: flex; flex-direction: column; gap: 8px; }
.block-title { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }

.mp-row { display: flex; align-items: center; gap: 12px; padding: 0 14px; height: 60px; border: 0; border-radius: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; text-align: left; }
.mp-row-light { background: rgba(15, 23, 42, 0.04); }
.mp-row-dark { background: rgba(255, 255, 255, 0.04); }
.row-flag { font-size: 22px; width: 28px; text-align: center; flex-shrink: 0; }
.row-meta { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.row-title { font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-sub { font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 500; }
.row-go { flex-shrink: 0; opacity: 0.6; }

.info-state { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 32px 16px; font-family: 'Manrope', sans-serif; font-size: 14px; line-height: 1.45; }

.remove-link { all: unset; display: inline-flex; align-items: center; gap: 6px; align-self: center; padding: 8px 12px; font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 600; color: #b91c1c; cursor: pointer; -webkit-tap-highlight-color: transparent; }
body.body--dark .remove-link { color: #fca5a5; }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }
</style>
