<!--
  Kiosk Mode, built the way Apple's Guided Access sits in Settings (issue
  #449): one switch, and under it everything that belongs to the register.

    - The first visit explains Kiosk Mode in the illustrated pop-up, once.
    - Turning the switch on asks for a new PIN (KioskPinSheet). Payments go
      to the wallet chosen before, else the active one, else the first that
      can take them; Receiving Wallet right below changes it.
    - Open Register starts the register. From then on BuhoGO opens as the
      register every time it starts, until the switch is turned off.
    - Inside the owner area the PIN is not asked again: Change PIN sets a new
      one and the switch turns kiosk off, keeping its settings for next time.

  The kiosk route guard (boot/kiosk.js) keeps this page closed while the
  register runs.
-->
<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('Settings')" to="/settings" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('kiosk.kioskMode') }}</h1>

      <IdentityGroup :footer="kioskOn ? $t('BuhoGO opens as the register every time it starts. Staff can take payments and nothing else.') : $t('Turns this phone into a register. Staff can take payments and nothing else.')">
        <IdentityRow :label="$t('kiosk.kioskMode')" :interactive="false" data-audit="kiosk-switch">
          <template #trailing>
            <q-toggle :model-value="kioskOn" color="positive" :aria-label="$t('kiosk.kioskMode')" @update:model-value="setKiosk" />
          </template>
        </IdentityRow>
      </IdentityGroup>

      <template v-if="kioskOn">
        <button type="button" class="btn-primary km-open" :disabled="starting" data-audit="kiosk-open-register" @click="openRegister">
          <q-spinner v-if="starting" size="18px" />
          <template v-else>{{ $t('Open Register') }}</template>
        </button>

        <IdentityGroup :title="$t('Payments')">
          <IdentityRow :label="$t('Receiving Wallet')" @click="walletSheetOpen = true">
            <template #trailing>
              <span class="km-value" :class="{ 'km-value--warn': !receivingWallet || receivingWallet.blocked }">{{ receivingValue }}</span>
            </template>
          </IdentityRow>
          <IdentityRow :label="$t('Show Amounts In')" :interactive="false">
            <template #trailing>
              <div class="km-seg" role="radiogroup" :aria-label="$t('Show Amounts In')">
                <button
                  v-for="option in displayOptions"
                  :key="option.value"
                  type="button"
                  role="radio"
                  class="km-seg-btn"
                  :class="{ 'km-seg-btn--on': walletStore.kioskDisplayCurrency === option.value }"
                  :aria-checked="walletStore.kioskDisplayCurrency === option.value ? 'true' : 'false'"
                  @click="walletStore.setKioskDisplayCurrency(option.value)"
                >{{ option.label }}</button>
              </div>
            </template>
          </IdentityRow>
        </IdentityGroup>

        <IdentityGroup :title="$t('Checkout')">
          <IdentityRow :label="$t('Tips')" :interactive="false">
            <template #trailing>
              <q-toggle :model-value="walletStore.kioskTipEnabled" color="positive" :aria-label="$t('Tips')" @update:model-value="walletStore.setKioskTipEnabled" />
            </template>
          </IdentityRow>
          <div v-if="walletStore.kioskTipEnabled" class="km-tips">
            <span class="km-tips-label">{{ $t('Tip Choices') }}</span>
            <div class="km-tips-fields">
              <q-input
                v-for="(value, idx) in walletStore.kioskTipValues"
                :key="idx"
                :model-value="value"
                type="number"
                min="0"
                suffix="%"
                dense
                filled
                :dark="$q.dark.isActive"
                :aria-label="$t('Tip choice {n}', { n: idx + 1 })"
                class="km-tip"
                @update:model-value="(v) => setTip(idx, v)"
              />
            </div>
          </div>
          <IdentityRow :label="$t('kiosk.roundUp')" :caption="$t('kiosk.roundUpDesc')" :interactive="false" wrap>
            <template #trailing>
              <q-toggle :model-value="walletStore.kioskRoundUpEnabled" color="positive" :aria-label="$t('kiosk.roundUp')" @update:model-value="walletStore.setKioskRoundUpEnabled" />
            </template>
          </IdentityRow>
        </IdentityGroup>

        <IdentityGroup :footer="$t('You need your PIN to leave the register. It is never shown.')">
          <IdentityRow :label="$t('Change PIN')" @click="pinSheet = 'change'" />
        </IdentityGroup>
      </template>
    </div>

    <KioskIntroDialog v-model="introOpen" @continue="closeIntro" @cancel="leaveIntro" />
    <KioskPinSheet v-model="pinSheetOpen" :heading="pinSheet === 'change' ? $t('Change PIN') : $t('kiosk.kioskMode')" :changing="pinSheet === 'change'" @done="savePin" />
    <KioskWalletSheet v-model="walletSheetOpen" :options="walletOptions" :selected="walletStore.kioskWalletId || ''" @select="setWallet" />
    <SettingsHubNav />
  </q-page>
</template>

<script>
import IdentityNav from '../components/identity/IdentityNav.vue';
import IdentityGroup from '../components/identity/IdentityGroup.vue';
import IdentityRow from '../components/identity/IdentityRow.vue';
import SettingsHubNav from '../components/settings/SettingsHubNav.vue';
import KioskIntroDialog from '../components/kiosk/KioskIntroDialog.vue';
import KioskPinSheet from '../components/kiosk/KioskPinSheet.vue';
import KioskWalletSheet from '../components/kiosk/KioskWalletSheet.vue';
import { useWalletStore } from '../stores/wallet';
import { kioskWalletBlocker, KIOSK_BLOCKER } from '../utils/walletCapabilities.js';
import { walletTypeLabel } from '../utils/walletNames.js';

/** Set once the intro pop-up was read (Continue), on this phone. */
const INTRO_SEEN_KEY = 'buhoGO_kiosk_intro_seen';

function introSeen() {
  try { return localStorage.getItem(INTRO_SEEN_KEY) === '1'; } catch { return false; }
}

export default {
  name: 'KioskModePage',
  components: { IdentityNav, IdentityGroup, IdentityRow, SettingsHubNav, KioskIntroDialog, KioskPinSheet, KioskWalletSheet },
  setup() {
    return { walletStore: useWalletStore() };
  },
  data() {
    return {
      introOpen: false,
      /** Which PIN the sheet is for: 'on' (turning kiosk on), 'change', or null. */
      pinSheet: null,
      walletSheetOpen: false,
      starting: false,
    };
  },
  computed: {
    kioskOn() {
      return !!this.walletStore.kioskEnabled;
    },
    /** Every wallet, each saying whether the register can charge into it (utils/walletCapabilities). */
    walletOptions() {
      return this.walletStore.wallets.map((wallet) => {
        const reason = this.blockerText(kioskWalletBlocker(wallet));
        return { id: wallet.id, name: wallet.name, type: wallet.type, caption: reason || walletTypeLabel(wallet), blocked: !!reason };
      });
    },
    eligibleWallets() {
      return this.walletOptions.filter((option) => !option.blocked);
    },
    receivingWallet() {
      return this.walletOptions.find((option) => option.id === this.walletStore.kioskWalletId) || null;
    },
    receivingValue() {
      const wallet = this.receivingWallet;
      if (!wallet) return this.$t('Choose');
      // Chosen before its connection lost a grant: say so where it is set.
      return wallet.blocked ? `${wallet.name} · ${wallet.caption}` : wallet.name;
    },
    displayOptions() {
      return [
        { value: 'sats', label: this.$t('Bitcoin') },
        { value: 'fiat', label: this.walletStore.preferredFiatCurrency },
      ];
    },
    pinSheetOpen: {
      get() { return this.pinSheet !== null; },
      set(open) { if (!open) this.pinSheet = null; },
    },
  },
  mounted() {
    if (!this.kioskOn && !introSeen()) this.introOpen = true;
  },
  methods: {
    blockerText(blocker) {
      if (blocker === KIOSK_BLOCKER.CANNOT_RECEIVE) return this.$t("Can't receive");
      if (blocker === KIOSK_BLOCKER.CANNOT_CONFIRM) return this.$t("Can't confirm payments");
      return '';
    },
    closeIntro() {
      try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* it shows once more next time */ }
      this.introOpen = false;
    },
    leaveIntro() {
      this.introOpen = false;
      this.$router.push('/settings');
    },
    /** The wallet chosen before, else the active one, else the first that can take payments. */
    defaultWalletId() {
      const usable = new Set(this.eligibleWallets.map((option) => option.id));
      const preferred = [this.walletStore.kioskWalletId, this.walletStore.activeWalletId].find((id) => id && usable.has(id));
      return preferred || this.eligibleWallets[0]?.id || null;
    },
    setKiosk(on) {
      if (!on) {
        this.walletStore.disableKiosk();
        return;
      }
      if (!this.eligibleWallets.length) {
        this.$q.notify({ message: this.$t('Kiosk needs a wallet that can create Lightning invoices. Add a Spark, LNbits or NWC wallet first.'), color: 'warning' });
        return;
      }
      // The switch only turns on once a PIN is saved; Cancel leaves it off.
      this.pinSheet = 'on';
    },
    async savePin(pin) {
      if (this.pinSheet === 'change') {
        await this.walletStore.changeKioskPin(pin);
        this.$q.notify({ message: this.$t('kiosk.pinChanged'), color: 'positive' });
        return;
      }
      await this.walletStore.enableKiosk(pin, this.defaultWalletId());
    },
    async setWallet(id) {
      // Never save a wallet the register cannot charge into.
      if (!this.eligibleWallets.some((option) => option.id === id)) return;
      await this.walletStore.setKioskWallet(id);
    },
    setTip(idx, value) {
      const next = [...this.walletStore.kioskTipValues];
      next[idx] = Math.max(0, parseInt(value, 10) || 0);
      this.walletStore.setKioskTipValues(next);
    },
    async openRegister() {
      // A wallet removed since, or one whose connection lost a grant, would
      // show a QR that can never be paid: choose another one first.
      const wallet = this.receivingWallet;
      if (!wallet || wallet.blocked) {
        this.$q.notify({ message: this.$t('Choose a kiosk wallet that can take payments'), caption: wallet ? `${wallet.name} · ${wallet.caption}` : undefined, color: 'warning' });
        this.walletSheetOpen = true;
        return;
      }
      this.starting = true;
      try {
        await this.walletStore.activateKioskMode();
        this.$router.push('/kiosk');
      } catch (err) {
        console.error('Kiosk activation failed:', err);
        this.walletStore.showPaymentError(err, {
          context: 'kiosk',
          walletType: this.walletStore.activeWalletType,
          route: 'Kiosk activation',
          t: this.$t.bind(this),
        });
      } finally {
        this.starting = false;
      }
    },
  },
};
</script>

<style scoped>
.km-open { margin: 16px 0 28px; }

.km-value {
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  color: var(--text-secondary);
}
.km-value--warn { color: #8A5A00; }
body.body--dark .km-value--warn { color: #F5C451; }

/* Two-way choice inside a row, like a segmented control. */
.km-seg {
  display: inline-flex;
  flex: none;
  padding: 2px;
  border-radius: 9px;
  background: var(--bg-input);
}
.km-seg-btn {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font: 600 13px/1 'Manrope', sans-serif;
  cursor: pointer;
}
.km-seg-btn--on {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* Sits between two rows, so it draws the divider rows draw for each other. */
.km-tips {
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border-card);
}
.km-tips + .id-row { border-top: 1px solid var(--border-card); }
.km-tips-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.km-tips-fields {
  display: flex;
  gap: 8px;
}
.km-tip {
  flex: 1;
  min-width: 0;
}
.km-tip :deep(.q-field__control) { border-radius: 10px; }
</style>
