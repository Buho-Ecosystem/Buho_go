<!--
  AutoTransferStatusLine: a rule that needs the person, said in one written
  line on Home ("Auto-Transfer couldn't send to Savings"). Tapping it opens
  a sheet: what happened, that the money stayed, and what to do (Try Again,
  Change Destination, Pause Rule). Nothing to dismiss: the line leaves once
  the rule sends again or is paused.

  A background transfer never opens an alert over what the person is
  doing; this line is the only place it speaks up.
-->
<template>
  <button v-if="entry" type="button" class="at-line" data-audit="auto-transfer-line" @click="open = true">
    <Icon icon="tabler:arrow-autofit-right" width="16" height="16" class="at-line__icon" aria-hidden="true" />
    <span class="at-line__text">{{ copy.line }}</span>
    <Icon icon="tabler:chevron-right" width="14" height="14" class="at-line__chevron" aria-hidden="true" />
  </button>

  <q-dialog v-model="open" position="bottom">
    <section v-if="entry" class="at-alert" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <span class="at-alert__icon" aria-hidden="true"><Icon icon="tabler:arrow-autofit-right" width="26" height="26" /></span>
      <h2 :id="titleId">{{ copy.title }}</h2>
      <p v-if="copy.text">{{ copy.text }}</p>
      <div class="at-alert__actions">
        <button v-if="copy.canRetry" type="button" class="form-sheet-primary" :disabled="trying" @click="tryAgain">
          <q-spinner v-if="trying" size="18px" />
          <template v-else>{{ $t('Try Again') }}</template>
        </button>
        <button type="button" class="at-alert__secondary" @click="changeDestination">{{ $t('Change Destination') }}</button>
        <button v-if="entry.rule.enabled" type="button" class="at-alert__secondary at-alert__secondary--quiet" @click="pause">{{ $t('Pause Rule') }}</button>
      </div>
    </section>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useWalletStore } from '../../stores/wallet'
import { useAutoWithdrawStore } from '../../stores/autoWithdraw'
import { attentionCopy } from '../../utils/autoTransferCopy.js'

// vue-i18n runs in legacy mode, so useI18n() throws; use the instance's $t.
const { proxy } = getCurrentInstance()
const router = useRouter()
const walletStore = useWalletStore()
const autoTransfer = useAutoWithdrawStore()
const open = ref(false)
const trying = ref(false)
const titleId = `at-alert-${Math.random().toString(36).slice(2, 8)}`

/** The first rule needing attention whose wallet is still here. */
const entry = computed(() => autoTransfer.needingAttention.find((e) => walletStore.wallets.some((w) => w.id === e.walletId)) || null)

const copy = computed(() => {
  const wallet = walletStore.wallets.find((w) => w.id === entry.value?.walletId)
  if (!wallet) return {}
  const ctx = { t: (key, values) => proxy.$t(key, values), locale: proxy.$i18n.locale, bip177: walletStore.useBip177Format, wallets: walletStore.wallets }
  return attentionCopy(entry.value.rule, { walletName: wallet.name, balanceSats: walletStore.getDisplayBalance(wallet.id)?.balance ?? 0 }, ctx) || {}
})

// The sheet closes by itself once nothing needs the person.
watch(entry, (value) => { if (!value) open.value = false })

async function tryAgain() {
  trying.value = true
  try {
    await autoTransfer.tryNow(entry.value.walletId, walletStore)
  } finally {
    trying.value = false
  }
}

function changeDestination() {
  const walletId = entry.value.walletId
  open.value = false
  router.push({ path: `/auto-transfer/${walletId}`, query: { edit: 1 } })
}

function pause() {
  autoTransfer.setEnabled(entry.value.walletId, false)
  open.value = false
}
</script>

<style scoped>
.at-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  max-width: 100%;
  min-height: 44px;
  margin: 2px auto 0;
  padding: 0 12px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  font: 500 14px 'Manrope', sans-serif;
  cursor: pointer;
}
.at-line__icon { flex-shrink: 0; color: #8A5A00; }
.body--dark .at-line__icon { color: #F5C451; }
.at-line__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.at-line__chevron { flex-shrink: 0; color: var(--text-muted, var(--text-secondary)); }
.at-line:focus-visible { outline: 2px solid var(--brand-accent-text); outline-offset: 2px; border-radius: 10px; }

/* Quasar only makes a dialog's direct child <div> tappable; this root is a <section>. */
.at-alert {
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  border-top: 1px solid var(--border-card);
  padding: 0 20px max(20px, var(--safe-bottom, 0px));
  font-family: 'Manrope', sans-serif;
}
.at-alert__icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  margin: 8px 0 14px;
  border-radius: 50%;
  background: rgba(196, 140, 20, 0.16);
  color: #8A5A00;
}
.body--dark .at-alert__icon { background: rgba(245, 196, 81, 0.14); color: #F5C451; }
.at-alert h2 { margin: 0; font-size: 22px; font-weight: 800; line-height: 1.25; text-wrap: balance; }
.at-alert p { margin: 8px 0 0; max-width: 34ch; font-size: 15px; line-height: 1.5; color: var(--text-secondary); }
.at-alert__actions { display: grid; gap: 8px; width: 100%; margin-top: 22px; }
.at-alert__actions .form-sheet-primary { width: 100%; }
.at-alert__actions .form-sheet-primary:disabled { opacity: 0.5; }
.at-alert__secondary {
  min-height: 50px;
  border-radius: 14px;
  border: 1px solid var(--border-card);
  background: none;
  color: var(--text-primary);
  font: 600 16px 'Manrope', sans-serif;
  cursor: pointer;
}
.at-alert__secondary--quiet { border-color: transparent; color: var(--text-secondary); }
</style>
