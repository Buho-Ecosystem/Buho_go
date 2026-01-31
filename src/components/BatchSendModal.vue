<!--
  BatchSendModal.vue
  Send payments to multiple contacts in one batch operation.
  5-step wizard: Select → Amount → Review → Execute → Summary
-->
<template>
  <q-dialog
    v-model="isVisible"
    position="bottom"
    persistent
    @before-hide="onBeforeHide"
  >
    <q-card class="batch-modal" :class="themeClass">
      <!-- Header -->
      <header class="modal-header">
        <div class="header-content">
          <div class="step-indicator">
            <div
              v-for="n in totalSteps"
              :key="n"
              class="step-dot"
              :class="getStepClass(n)"
            >
              <i v-if="n < step" class="las la-check"></i>
              <span v-else>{{ n }}</span>
            </div>
          </div>
          <h2 class="header-title">{{ stepTitle }}</h2>
        </div>
        <q-btn
          v-if="step !== 4"
          flat
          round
          dense
          icon="las la-times"
          class="close-btn"
          @click="confirmClose"
        />
      </header>

      <!-- Body -->
      <main class="modal-body">
        <!-- Step 1: Contact Selection -->
        <section v-if="step === 1" class="step-content">
          <!-- Selection Header -->
          <div class="selection-header">
            <div class="selection-count">
              <span class="count-number">{{ selectedContacts.length }}</span>
              <span class="count-label">{{ $t('contacts selected') }}</span>
            </div>
            <div class="selection-actions">
              <q-btn
                flat
                no-caps
                dense
                size="sm"
                :label="$t('Select All')"
                class="action-link"
                @click="selectAll"
                :disable="selectableContacts.length === 0"
              />
              <q-btn
                flat
                no-caps
                dense
                size="sm"
                :label="$t('Clear')"
                class="action-link"
                @click="clearSelection"
                :disable="selectedContacts.length === 0"
              />
            </div>
          </div>

          <!-- Search -->
          <div class="search-container">
            <i class="las la-search search-icon"></i>
            <input
              v-model="searchQuery"
              type="text"
              :placeholder="$t('Search contacts...')"
              class="search-input"
            />
            <i
              v-if="searchQuery"
              class="las la-times-circle clear-icon"
              @click="searchQuery = ''"
            ></i>
          </div>

          <!-- Contact List -->
          <div class="contact-list">
            <div
              v-for="contact in filteredContacts"
              :key="contact.id"
              class="contact-item"
              :class="{ 'contact-selected': isSelected(contact), 'contact-disabled': !canSelectContact(contact) }"
              @click="toggleContact(contact)"
            >
              <!-- Checkbox -->
              <div class="contact-checkbox">
                <div class="checkbox-box" :class="{ 'checkbox-checked': isSelected(contact) }">
                  <i v-if="isSelected(contact)" class="las la-check"></i>
                </div>
              </div>

              <!-- Avatar with Type Indicator -->
              <div class="avatar-wrap">
                <div class="contact-avatar" :style="{ background: contact.color || '#3B82F6' }">
                  <span>{{ getInitial(contact.name) }}</span>
                </div>
                <div class="type-dot" :style="{ background: getTypeColor(contact.addressType) }">
                  <svg v-if="contact.addressType === 'spark'" width="10" height="10" viewBox="0 0 135 128" fill="white">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z"/>
                  </svg>
                  <i v-else-if="contact.addressType === 'bitcoin'" class="lab la-bitcoin"></i>
                  <i v-else class="las la-bolt"></i>
                </div>
              </div>

              <!-- Info -->
              <div class="contact-info">
                <div class="contact-name">
                  {{ contact.name }}
                  <i v-if="contact.isFavorite" class="las la-star favorite-star"></i>
                </div>
                <div class="contact-address">{{ truncateAddress(contact.address || contact.lightningAddress) }}</div>
              </div>
            </div>

            <!-- Empty State -->
            <div v-if="filteredContacts.length === 0" class="empty-state">
              <i class="las la-search"></i>
              <span>{{ $t('No contacts found') }}</span>
            </div>
          </div>

          <!-- Spark-only Contacts Warning -->
          <div v-if="hasSparkOnlySelected && !isSparkWallet" class="warning-banner">
            <i class="las la-exclamation-triangle"></i>
            <span>{{ $t('Some contacts require Spark wallet') }}</span>
          </div>
        </section>

        <!-- Step 2: Amount Entry -->
        <section v-if="step === 2" class="step-content">
          <!-- Recipients Summary -->
          <div class="recipients-summary">
            <div class="recipients-avatars">
              <div
                v-for="(contact, idx) in selectedContacts.slice(0, 4)"
                :key="contact.id"
                class="mini-avatar-wrap"
                :style="{ zIndex: 10 - idx }"
              >
                <div class="mini-avatar" :style="{ background: contact.color || '#3B82F6' }">
                  {{ getInitial(contact.name) }}
                </div>
                <div class="mini-type-dot" :style="{ background: getTypeColor(contact.addressType) }">
                  <svg v-if="contact.addressType === 'spark'" width="6" height="6" viewBox="0 0 135 128" fill="white">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z"/>
                  </svg>
                  <i v-else-if="contact.addressType === 'bitcoin'" class="lab la-bitcoin"></i>
                  <i v-else class="las la-bolt"></i>
                </div>
              </div>
              <div v-if="selectedContacts.length > 4" class="mini-avatar-wrap">
                <div class="mini-avatar more-count">
                  +{{ selectedContacts.length - 4 }}
                </div>
              </div>
            </div>
            <span class="recipients-text">
              {{ $t('Sending to {count} contacts', { count: selectedContacts.length }) }}
            </span>
          </div>

          <!-- Mode Toggle -->
          <div class="mode-toggle">
            <button
              class="mode-btn"
              :class="{ 'mode-active': !customAmountsMode }"
              @click="customAmountsMode = false"
            >
              <i class="las la-equals"></i>
              <span class="mode-label">{{ $t('Same amount') }}</span>
            </button>
            <button
              class="mode-btn"
              :class="{ 'mode-active': customAmountsMode }"
              @click="customAmountsMode = true"
            >
              <i class="las la-sliders-h"></i>
              <span class="mode-label">{{ $t('Custom amounts') }}</span>
            </button>
          </div>

          <!-- UNIFORM MODE -->
          <template v-if="!customAmountsMode">
            <!-- Amount Input -->
            <div class="amount-input-section">
              <div class="amount-input-wrap">
                <input
                  ref="amountInput"
                  v-model="amountDisplay"
                  type="text"
                  inputmode="decimal"
                  class="amount-input"
                  :placeholder="currency === 'sats' ? '0' : '0.00'"
                  @input="onAmountInput"
                  @blur="formatAmount"
                />
                <button class="currency-toggle" @click="toggleCurrency">
                  {{ currency === 'sats' ? 'sats' : fiatCurrency }}
                </button>
              </div>
              <div class="amount-conversion">
                {{ currency === 'sats' ? fiatEquivalent : satsEquivalent }}
              </div>
            </div>

            <!-- Calculation Preview -->
            <div v-if="amountPerRecipient > 0" class="calc-preview">
              <div class="calc-breakdown">
                <span class="calc-per-person">{{ formatSats(amountPerRecipient) }} sats</span>
                <span class="calc-multiply">× {{ selectedContacts.length }} {{ $t('recipients') }}</span>
              </div>
              <div class="calc-equals">=</div>
              <div class="calc-result">
                <span class="calc-total-sats">{{ formatSats(totalAmount) }} sats</span>
                <span class="calc-total-fiat">{{ getFiatValue(totalAmount) }}</span>
              </div>
            </div>
          </template>

          <!-- CUSTOM MODE -->
          <template v-else>
            <!-- DISABLED: Quick Fill Helper - commented out for simplicity
            <div class="quick-fill">
              <input
                v-model="quickFillAmount"
                type="text"
                inputmode="decimal"
                class="quick-fill-input"
                :placeholder="$t('Amount')"
              />
              <q-btn
                flat
                dense
                no-caps
                class="quick-fill-btn"
                :disable="!quickFillAmount"
                @click="fillAllAmounts"
              >
                {{ $t('Fill all') }}
              </q-btn>
            </div>
            -->

            <div class="custom-amounts-list">
              <div
                v-for="contact in selectedContacts"
                :key="contact.id"
                class="custom-amount-row"
              >
                <div class="custom-contact">
                  <div class="avatar-wrap">
                    <div class="custom-avatar" :style="{ background: contact.color || '#3B82F6' }">
                      {{ getInitial(contact.name) }}
                    </div>
                    <div class="type-dot" :style="{ background: getTypeColor(contact.addressType) }">
                      <svg v-if="contact.addressType === 'spark'" width="10" height="10" viewBox="0 0 135 128" fill="white">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z"/>
                      </svg>
                      <i v-else-if="contact.addressType === 'bitcoin'" class="lab la-bitcoin"></i>
                      <i v-else class="las la-bolt"></i>
                    </div>
                  </div>
                  <span class="custom-name">{{ contact.name }}</span>
                </div>
                <div class="custom-input-wrap">
                  <input
                    type="text"
                    inputmode="decimal"
                    class="custom-input"
                    :value="customAmounts[contact.id] || ''"
                    placeholder="0"
                    @input="e => updateCustomAmount(contact.id, e.target.value)"
                  />
                  <span class="custom-unit">sats</span>
                </div>
              </div>
            </div>

            <!-- Custom Mode Total -->
            <div v-if="totalAmount > 0" class="custom-total-preview">
              <span class="custom-total-label">{{ $t('Total') }}:</span>
              <span class="custom-total-value">{{ formatSats(totalAmount) }} sats</span>
              <span class="custom-total-fiat">{{ getFiatValue(totalAmount) }}</span>
            </div>
          </template>

          <!-- Balance Card -->
          <div class="balance-card" :class="{ 'balance-warning': isOverSafeLimit, 'balance-error': isOverBalance }">
            <div class="balance-header">
              <i class="las la-wallet"></i>
              <span>{{ $t('Wallet Balance') }}</span>
            </div>
            <div class="balance-details">
              <div class="balance-item">
                <span class="balance-label">{{ $t('Available') }}</span>
                <span class="balance-value">{{ formatSats(walletBalance) }} sats</span>
              </div>
              <div class="balance-item balance-sending">
                <span class="balance-label">{{ $t('Sending') }}</span>
                <span class="balance-value">-{{ formatSats(totalAmount) }} sats</span>
              </div>
              <div class="balance-divider"></div>
              <div class="balance-item balance-remaining">
                <span class="balance-label">{{ $t('Remaining') }}</span>
                <span class="balance-value" :class="{ 'value-warning': isOverSafeLimit, 'value-error': isOverBalance }">
                  {{ formatSats(Math.max(0, remainingBalance)) }} sats
                </span>
              </div>
            </div>
          </div>

          <!-- Warning/Error Messages -->
          <div v-if="isOverBalance" class="error-banner">
            <i class="las la-exclamation-circle"></i>
            <span>{{ $t('Insufficient balance') }}</span>
          </div>
          <div v-else-if="isOverSafeLimit" class="warning-banner">
            <i class="las la-exclamation-triangle"></i>
            <span>{{ $t('1% reserved for potential fees') }}</span>
          </div>

          <!-- Custom Mode Validation -->
          <div v-if="customAmountsMode && !allContactsHaveAmount && totalAmount > 0" class="info-banner">
            <i class="las la-info-circle"></i>
            <span>{{ $t('Enter amount for all contacts') }}</span>
          </div>
        </section>

        <!-- Step 3: Review -->
        <section v-if="step === 3" class="step-content">
          <div class="review-list">
            <div
              v-for="contact in selectedContacts"
              :key="contact.id"
              class="review-item"
            >
              <div class="avatar-wrap">
                <div class="review-avatar" :style="{ background: contact.color || '#3B82F6' }">
                  {{ getInitial(contact.name) }}
                </div>
                <div class="type-dot" :style="{ background: getTypeColor(contact.addressType) }">
                  <svg v-if="contact.addressType === 'spark'" width="10" height="10" viewBox="0 0 135 128" fill="white">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z"/>
                  </svg>
                  <i v-else-if="contact.addressType === 'bitcoin'" class="lab la-bitcoin"></i>
                  <i v-else class="las la-bolt"></i>
                </div>
              </div>
              <div class="review-info">
                <div class="review-name">{{ contact.name }}</div>
                <div class="review-address">{{ truncateAddress(contact.address || contact.lightningAddress) }}</div>
              </div>
              <div class="review-amount">
                <div class="amount-sats">{{ formatSats(getContactAmount(contact)) }} sats</div>
                <div class="amount-fiat">{{ getFiatValue(getContactAmount(contact)) }}</div>
              </div>
            </div>
          </div>

          <!-- Fee Summary -->
          <div class="fee-summary">
            <div class="fee-row">
              <span>{{ $t('Subtotal') }}</span>
              <span>{{ formatSats(totalAmount) }} sats</span>
            </div>
            <div class="fee-row">
              <span>{{ $t('Est. fees') }}</span>
              <span>~{{ formatSats(estimatedFees) }} sats</span>
            </div>
            <div class="fee-row fee-total">
              <span>{{ $t('Total') }}</span>
              <span>{{ formatSats(totalAmount + estimatedFees) }} sats</span>
            </div>
          </div>
        </section>

        <!-- Step 4: Executing -->
        <section v-if="step === 4" class="step-content">
          <!-- Progress Bar -->
          <div class="progress-section">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="progress-text">
              {{ completedCount }} / {{ selectedContacts.length }} {{ $t('payments sent') }}
            </div>
          </div>

          <!-- Payment List -->
          <div class="execution-list">
            <div
              v-for="(result, idx) in paymentResults"
              :key="idx"
              class="execution-item"
              :class="'status-' + result.status"
            >
              <div class="avatar-wrap avatar-wrap-sm">
                <div class="exec-avatar" :style="{ background: result.contact.color || '#3B82F6' }">
                  {{ getInitial(result.contact.name) }}
                </div>
                <div class="type-dot type-dot-sm" :style="{ background: getTypeColor(result.contact.addressType) }">
                  <svg v-if="result.contact.addressType === 'spark'" width="8" height="8" viewBox="0 0 135 128" fill="white">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z"/>
                  </svg>
                  <i v-else-if="result.contact.addressType === 'bitcoin'" class="lab la-bitcoin"></i>
                  <i v-else class="las la-bolt"></i>
                </div>
              </div>
              <div class="exec-info">
                <div class="exec-name">{{ result.contact.name }}</div>
                <div class="exec-status">
                  <span v-if="result.status === 'pending'" class="status-text">{{ $t('Waiting...') }}</span>
                  <span v-else-if="result.status === 'sending'" class="status-text">{{ $t('Sending...') }}</span>
                  <span v-else-if="result.status === 'success'" class="status-text status-success">{{ $t('Sent') }}</span>
                  <span v-else-if="result.status === 'failed'" class="status-text status-failed">{{ result.error }}</span>
                  <span v-else-if="result.status === 'skipped'" class="status-text status-skipped">{{ result.error }}</span>
                </div>
              </div>
              <div class="exec-amount">{{ formatSats(result.amount) }}</div>
              <div class="exec-icon">
                <q-spinner-dots v-if="result.status === 'sending'" size="20px" color="green" />
                <i v-else-if="result.status === 'success'" class="las la-check-circle icon-success"></i>
                <i v-else-if="result.status === 'failed'" class="las la-times-circle icon-failed"></i>
                <i v-else-if="result.status === 'skipped'" class="las la-minus-circle icon-skipped"></i>
                <i v-else class="las la-clock icon-pending"></i>
              </div>
            </div>
          </div>

          <!-- Cancel Button -->
          <q-btn
            v-if="!isComplete && !isCancelled"
            flat
            no-caps
            class="cancel-btn"
            @click="cancelBatch"
          >
            {{ $t('Cancel Remaining') }}
          </q-btn>
        </section>

        <!-- Step 5: Summary -->
        <section v-if="step === 5" class="step-content">
          <div class="summary-section">
            <!-- Success Icon -->
            <div class="summary-icon" :class="failedCount > 0 ? 'icon-partial' : 'icon-success'">
              <i :class="failedCount > 0 ? 'las la-exclamation-circle' : 'las la-check-circle'"></i>
            </div>

            <!-- Stats -->
            <h3 class="summary-title">
              {{ failedCount === 0 ? $t('Batch Complete') : $t('Batch Finished') }}
            </h3>

            <div class="summary-stats">
              <div class="stat-item stat-success">
                <i class="las la-check"></i>
                <span>{{ successCount }} {{ $t('sent') }}</span>
              </div>
              <div v-if="failedCount > 0" class="stat-item stat-failed">
                <i class="las la-times"></i>
                <span>{{ failedCount }} {{ $t('failed') }}</span>
              </div>
            </div>

            <div class="summary-total">
              {{ $t('Total sent') }}: <strong>{{ formatSats(totalSent) }} sats</strong>
            </div>

            <!-- Failed List -->
            <div v-if="failedCount > 0" class="failed-list">
              <div class="failed-header">{{ $t('Failed payments') }}:</div>
              <div
                v-for="result in failedResults"
                :key="result.contact.id"
                class="failed-item"
              >
                <span class="failed-name">{{ result.contact.name }}</span>
                <span class="failed-error">{{ result.error }}</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <!-- Footer -->
      <footer class="modal-footer">
        <!-- Step 1 -->
        <template v-if="step === 1">
          <q-btn flat no-caps class="btn-secondary" @click="close">
            {{ $t('Cancel') }}
          </q-btn>
          <q-btn
            unelevated
            no-caps
            class="btn-primary"
            :disable="selectedContacts.length === 0"
            @click="nextStep"
          >
            {{ $t('Continue') }}
          </q-btn>
        </template>

        <!-- Step 2 -->
        <template v-else-if="step === 2">
          <q-btn flat no-caps class="btn-secondary" @click="prevStep">
            {{ $t('Back') }}
          </q-btn>
          <q-btn
            unelevated
            no-caps
            class="btn-primary"
            :disable="!canProceedFromAmount"
            @click="nextStep"
          >
            {{ $t('Review') }}
          </q-btn>
        </template>

        <!-- Step 3 -->
        <template v-else-if="step === 3">
          <q-btn flat no-caps class="btn-secondary" @click="prevStep">
            {{ $t('Back') }}
          </q-btn>
          <q-btn
            unelevated
            no-caps
            class="btn-primary"
            @click="startBatch"
          >
            {{ $t('Send {count} Payments', { count: selectedContacts.length }) }}
          </q-btn>
        </template>

        <!-- Step 4 - No footer during execution -->

        <!-- Step 5 -->
        <template v-else-if="step === 5">
          <q-btn
            v-if="failedCount > 0"
            flat
            no-caps
            class="btn-secondary"
            @click="retryFailed"
          >
            {{ $t('Retry Failed') }}
          </q-btn>
          <q-btn unelevated no-caps class="btn-primary" @click="close">
            {{ $t('Done') }}
          </q-btn>
        </template>
      </footer>
    </q-card>
  </q-dialog>

  <!-- Confirmation Dialog -->
  <q-dialog v-model="showConfirmClose" persistent>
    <div class="confirm-dialog" :class="themeClass">
      <div class="confirm-icon">
        <i class="las la-exclamation-circle"></i>
      </div>
      <h3 class="confirm-title">{{ $t('Cancel Batch?') }}</h3>
      <p class="confirm-message">{{ $t('Your selection will be lost.') }}</p>
      <div class="confirm-actions">
        <button class="confirm-btn confirm-btn-cancel" @click="showConfirmClose = false">
          {{ $t('Go Back') }}
        </button>
        <button class="confirm-btn confirm-btn-confirm" @click="confirmAndClose">
          {{ $t('Yes, Cancel') }}
        </button>
      </div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick, getCurrentInstance } from 'vue'
import { useQuasar } from 'quasar'
import { useWalletStore } from '../stores/wallet'
import { useAddressBookStore } from '../stores/addressBook'
import LightningPaymentService from '../utils/lightning.js'

// ─────────────────────────────────────────────────────────────
// Props / Emits
// ─────────────────────────────────────────────────────────────
const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'batch-completed'])

// ─────────────────────────────────────────────────────────────
// Composables
// ─────────────────────────────────────────────────────────────
const $q = useQuasar()
const { proxy } = getCurrentInstance()
const t = (key, params) => proxy.$t(key, params)
const walletStore = useWalletStore()
const addressBookStore = useAddressBookStore()

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const totalSteps = 5
const FEE_BUFFER_PERCENT = 0.01 // 1% reserved for fees
const DEFAULT_AVATAR_COLOR = '#3B82F6'
const WALLET_TYPES = { SPARK: 'spark', LNBITS: 'lnbits', NWC: 'nwc' }

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
const step = ref(1)
const searchQuery = ref('')
const selectedContacts = ref([])
const amountDisplay = ref('')
const currency = ref('sats')
const paymentResults = ref([])
const isExecuting = ref(false)
const isCancelled = ref(false)
const amountInput = ref(null)
const customAmountsMode = ref(false)
const customAmounts = ref({}) // { contactId: amountInSats }
const quickFillAmount = ref('')
const showConfirmClose = ref(false)

// ─────────────────────────────────────────────────────────────
// Computed - Visibility
// ─────────────────────────────────────────────────────────────
const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const themeClass = computed(() => $q.dark.isActive ? 'theme-dark' : 'theme-light')

// ─────────────────────────────────────────────────────────────
// Computed - Wallet
// ─────────────────────────────────────────────────────────────
const isSparkWallet = computed(() => walletStore.isActiveWalletSpark)
const walletBalance = computed(() => walletStore.balances[walletStore.activeWalletId] || 0)
const fiatCurrency = computed(() => 'USD') // Could be made configurable
const btcPrice = computed(() => walletStore.btcPrice || 100000) // Fallback price

// ─────────────────────────────────────────────────────────────
// Computed - Contacts
// ─────────────────────────────────────────────────────────────
const allContacts = computed(() => {
  return [...addressBookStore.entries].sort((a, b) => {
    // Favorites first, then alphabetical
    if (a.isFavorite && !b.isFavorite) return -1
    if (!a.isFavorite && b.isFavorite) return 1
    return a.name.localeCompare(b.name)
  })
})

const selectableContacts = computed(() => {
  return allContacts.value.filter(c => canSelectContact(c))
})

const filteredContacts = computed(() => {
  if (!searchQuery.value.trim()) return allContacts.value
  const q = searchQuery.value.toLowerCase()
  return allContacts.value.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.address || c.lightningAddress || '').toLowerCase().includes(q)
  )
})

const hasBitcoinSelected = computed(() => {
  return selectedContacts.value.some(c => c.addressType === 'bitcoin')
})

const hasSparkOnlySelected = computed(() => {
  return selectedContacts.value.some(c => c.addressType === 'spark' || c.addressType === 'bitcoin')
})

// ─────────────────────────────────────────────────────────────
// Computed - Amount
// ─────────────────────────────────────────────────────────────
const amountPerRecipient = computed(() => {
  const val = parseFloat(amountDisplay.value.replace(/,/g, '')) || 0
  if (currency.value === 'sats') {
    return Math.floor(val)
  }
  // Convert fiat to sats
  return Math.floor((val / btcPrice.value) * 100000000)
})

const totalAmount = computed(() => {
  if (customAmountsMode.value) {
    // Sum all custom amounts
    return selectedContacts.value.reduce((sum, contact) => {
      return sum + (parseInt(customAmounts.value[contact.id]) || 0)
    }, 0)
  }
  return selectedContacts.value.length * amountPerRecipient.value
})

const maxSendable = computed(() => {
  return Math.floor(walletBalance.value * (1 - FEE_BUFFER_PERCENT))
})

const remainingBalance = computed(() => {
  return walletBalance.value - totalAmount.value
})

const isOverBalance = computed(() => totalAmount.value > walletBalance.value)
const isOverSafeLimit = computed(() => totalAmount.value > maxSendable.value && !isOverBalance.value)

const allContactsHaveAmount = computed(() => {
  return selectedContacts.value.every(c => {
    const amt = parseInt(customAmounts.value[c.id]) || 0
    return amt > 0
  })
})

const canProceedFromAmount = computed(() => {
  if (customAmountsMode.value) {
    return allContactsHaveAmount.value && !isOverBalance.value
  }
  return amountPerRecipient.value > 0 && !isOverBalance.value
})

const fiatEquivalent = computed(() => {
  const fiatVal = (amountPerRecipient.value / 100000000) * btcPrice.value
  return `~$${fiatVal.toFixed(2)} ${fiatCurrency.value}`
})

const satsEquivalent = computed(() => {
  return `~${formatSats(amountPerRecipient.value)} sats`
})

// ─────────────────────────────────────────────────────────────
// Computed - Fees
// ─────────────────────────────────────────────────────────────
const estimatedFees = computed(() => {
  let fees = 0
  for (const contact of selectedContacts.value) {
    const type = contact.addressType || 'lightning'
    const contactAmount = getContactAmount(contact)
    if (type === 'spark') {
      fees += 0 // Zero fee
    } else if (type === 'lightning') {
      fees += Math.ceil(contactAmount * 0.01) // ~1%
    } else if (type === 'bitcoin') {
      fees += 500 // Rough estimate for on-chain
    }
  }
  return fees
})

// ─────────────────────────────────────────────────────────────
// Computed - Step
// ─────────────────────────────────────────────────────────────
const stepTitle = computed(() => {
  const titles = {
    1: t('Select Contacts'),
    2: t('Set Amount'),
    3: t('Review'),
    4: t('Sending...'),
    5: t('Complete')
  }
  return titles[step.value]
})

// ─────────────────────────────────────────────────────────────
// Computed - Execution
// ─────────────────────────────────────────────────────────────
const completedCount = computed(() => {
  return paymentResults.value.filter(r =>
    r.status === 'success' || r.status === 'failed' || r.status === 'skipped'
  ).length
})

const successCount = computed(() => {
  return paymentResults.value.filter(r => r.status === 'success').length
})

const failedCount = computed(() => {
  return paymentResults.value.filter(r => r.status === 'failed' || r.status === 'skipped').length
})

const failedResults = computed(() => {
  return paymentResults.value.filter(r => r.status === 'failed' || r.status === 'skipped')
})

const totalSent = computed(() => {
  return paymentResults.value
    .filter(r => r.status === 'success')
    .reduce((sum, r) => sum + r.amount, 0)
})

const progressPercent = computed(() => {
  if (selectedContacts.value.length === 0) return 0
  return (completedCount.value / selectedContacts.value.length) * 100
})

const isComplete = computed(() => {
  return completedCount.value === selectedContacts.value.length
})

// ─────────────────────────────────────────────────────────────
// Watch
// ─────────────────────────────────────────────────────────────
watch(isVisible, async (val) => {
  if (val) {
    resetState()
    await addressBookStore.initialize()
  }
})

watch(step, (newStep) => {
  if (newStep === 2) {
    nextTick(() => {
      amountInput.value?.focus()
    })
  }
})

// ─────────────────────────────────────────────────────────────
// Methods - Helpers
// ─────────────────────────────────────────────────────────────
function getInitial(name) {
  return name ? name.charAt(0).toUpperCase() : '?'
}

function truncateAddress(addr) {
  if (!addr) return ''
  if (addr.length <= 20) return addr
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

function formatSats(sats) {
  return new Intl.NumberFormat().format(sats || 0)
}

function getFiatValue(sats) {
  const fiat = (sats / 100000000) * btcPrice.value
  return `$${fiat.toFixed(2)}`
}

function getContactAmount(contact) {
  if (customAmountsMode.value) {
    return parseInt(customAmounts.value[contact.id]) || 0
  }
  return amountPerRecipient.value
}

function updateCustomAmount(contactId, value) {
  // Only allow numbers
  const numericValue = value.replace(/[^0-9]/g, '')
  customAmounts.value[contactId] = numericValue
}

// DISABLED: fillAllAmounts - commented out for simplicity
// function fillAllAmounts() {
//   const amount = quickFillAmount.value.replace(/[^0-9]/g, '')
//   if (!amount) return
//   for (const contact of selectedContacts.value) {
//     customAmounts.value[contact.id] = amount
//   }
// }

function getTypeLabel(type) {
  const labels = { lightning: 'Lightning', spark: 'Spark', bitcoin: 'Bitcoin' }
  return labels[type] || labels.lightning
}

function getTypeColor(type) {
  const colors = {
    lightning: '#F7931A',  // Orange
    spark: '#000',         // Black
    bitcoin: '#F7931A'     // Orange
  }
  return colors[type] || colors.lightning
}

function getAvatarColor(contact) {
  return contact?.color || DEFAULT_AVATAR_COLOR
}

function getStepClass(n) {
  if (n < step.value) return 'step-completed'
  if (n === step.value) return 'step-current'
  return 'step-future'
}

function canSelectContact(contact) {
  // Bitcoin and Spark contacts only available with Spark wallet
  if ((contact.addressType === 'bitcoin' || contact.addressType === 'spark') && !isSparkWallet.value) {
    return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────
// Methods - Contact Selection
// ─────────────────────────────────────────────────────────────
function isSelected(contact) {
  return selectedContacts.value.some(c => c.id === contact.id)
}

function toggleContact(contact) {
  if (!canSelectContact(contact)) return

  const idx = selectedContacts.value.findIndex(c => c.id === contact.id)
  if (idx >= 0) {
    selectedContacts.value.splice(idx, 1)
  } else {
    selectedContacts.value.push(contact)
  }
}

function selectAll() {
  selectedContacts.value = [...selectableContacts.value]
}

function clearSelection() {
  selectedContacts.value = []
}

// ─────────────────────────────────────────────────────────────
// Methods - Amount
// ─────────────────────────────────────────────────────────────
function onAmountInput(e) {
  // Allow only numbers and decimal point
  let val = e.target.value.replace(/[^0-9.]/g, '')
  // Only one decimal point
  const parts = val.split('.')
  if (parts.length > 2) {
    val = parts[0] + '.' + parts.slice(1).join('')
  }
  amountDisplay.value = val
}

function formatAmount() {
  if (!amountDisplay.value) return
  const val = parseFloat(amountDisplay.value)
  if (isNaN(val)) {
    amountDisplay.value = ''
    return
  }
  if (currency.value === 'sats') {
    amountDisplay.value = Math.floor(val).toString()
  } else {
    amountDisplay.value = val.toFixed(2)
  }
}

function toggleCurrency() {
  const currentSats = amountPerRecipient.value
  currency.value = currency.value === 'sats' ? 'fiat' : 'sats'

  if (currentSats > 0) {
    if (currency.value === 'sats') {
      amountDisplay.value = currentSats.toString()
    } else {
      const fiat = (currentSats / 100000000) * btcPrice.value
      amountDisplay.value = fiat.toFixed(2)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Methods - Navigation
// ─────────────────────────────────────────────────────────────
function nextStep() {
  if (step.value < totalSteps) {
    step.value++
  }
}

function prevStep() {
  if (step.value > 1) {
    step.value--
  }
}

function resetState() {
  step.value = 1
  searchQuery.value = ''
  selectedContacts.value = []
  amountDisplay.value = ''
  currency.value = 'sats'
  paymentResults.value = []
  isExecuting.value = false
  isCancelled.value = false
  customAmountsMode.value = false
  customAmounts.value = {}
  quickFillAmount.value = ''
  showConfirmClose.value = false
}

function close() {
  isVisible.value = false
}

function confirmClose() {
  if (selectedContacts.value.length > 0 || amountDisplay.value) {
    showConfirmClose.value = true
  } else {
    close()
  }
}

function confirmAndClose() {
  showConfirmClose.value = false
  close()
}

function onBeforeHide() {
  if (step.value === 5) {
    emit('batch-completed', paymentResults.value)
  }
}

// ─────────────────────────────────────────────────────────────
// Methods - Execution Helpers
// ─────────────────────────────────────────────────────────────
async function fetchLightningAddressInvoice(address, amountSats) {
  const [username, domain] = address.split('@')
  if (!username || !domain) {
    throw new Error('Invalid Lightning address')
  }

  // Fetch LNURL endpoint info
  const endpoint = `https://${domain}/.well-known/lnurlp/${username}`
  const response = await fetch(endpoint)

  if (!response.ok) {
    throw new Error('Failed to fetch Lightning address info')
  }

  const data = await response.json()
  if (data.status === 'ERROR') {
    throw new Error(data.reason || 'Lightning address error')
  }

  // Validate amount
  const amountMs = amountSats * 1000
  if (data.minSendable && amountMs < data.minSendable) {
    throw new Error(`Minimum: ${Math.ceil(data.minSendable / 1000)} sats`)
  }
  if (data.maxSendable && amountMs > data.maxSendable) {
    throw new Error(`Maximum: ${Math.floor(data.maxSendable / 1000)} sats`)
  }

  // Request invoice
  const callbackUrl = `${data.callback}?amount=${amountMs}`
  const invoiceResponse = await fetch(callbackUrl)
  if (!invoiceResponse.ok) {
    throw new Error('Failed to get invoice')
  }

  const invoiceData = await invoiceResponse.json()
  if (invoiceData.status === 'ERROR') {
    throw new Error(invoiceData.reason || 'Invoice error')
  }

  return invoiceData.pr
}

function getActiveWallet() {
  return walletStore.connectedWallets?.find(
    w => w.id === walletStore.activeWalletId
  ) || null
}

function getActiveWalletType() {
  return getActiveWallet()?.type || WALLET_TYPES.SPARK
}

function getActiveWalletNwcString() {
  const wallet = getActiveWallet()
  // NWC wallets store the connection URL as 'nwcUrl'
  return wallet?.nwcUrl || wallet?.nwcString || null
}

// ─────────────────────────────────────────────────────────────
// Methods - Execution
// ─────────────────────────────────────────────────────────────
async function startBatch() {
  step.value = 4
  isExecuting.value = true
  isCancelled.value = false

  // Initialize results with correct amount per contact
  paymentResults.value = selectedContacts.value.map(contact => ({
    contact,
    amount: getContactAmount(contact),
    status: 'pending',
    error: null
  }))

  const walletType = getActiveWalletType()
  const provider = walletStore.getActiveProvider()

  // Execute payments sequentially
  for (let i = 0; i < paymentResults.value.length; i++) {
    if (isCancelled.value) break

    const result = paymentResults.value[i]
    result.status = 'sending'

    try {
      if (!provider) {
        throw new Error('Wallet not connected')
      }

      const address = result.contact.address || result.contact.lightningAddress
      const addressType = result.contact.addressType || 'lightning'

      // Handle Spark address type (only works with Spark wallet)
      if (addressType === 'spark') {
        if (walletType !== WALLET_TYPES.SPARK) {
          result.status = 'skipped'
          result.error = t('Requires Spark')
        } else {
          await provider.transferToSparkAddress(address, result.amount)
          result.status = 'success'
        }
      }
      // Handle Lightning address type
      else if (addressType === 'lightning') {
        if (walletType === WALLET_TYPES.SPARK) {
          // Spark has native payLightningAddress
          await provider.payLightningAddress(address, result.amount)
          result.status = 'success'
        } else if (walletType === WALLET_TYPES.LNBITS) {
          // LNBits: fetch invoice then pay
          const invoice = await fetchLightningAddressInvoice(address, result.amount)
          await provider.payInvoice({ invoice })
          result.status = 'success'
        } else if (walletType === WALLET_TYPES.NWC) {
          // NWC: create service and pay
          const nwcString = getActiveWalletNwcString()
          if (!nwcString) {
            throw new Error('NWC connection not found')
          }
          const lightningService = new LightningPaymentService(nwcString)
          const paymentData = await lightningService.processPaymentInput(address)
          await lightningService.sendPayment(paymentData, result.amount)
          result.status = 'success'
        } else {
          throw new Error('Unsupported wallet type')
        }
      }
      // Handle Bitcoin address type (only works with Spark wallet)
      else if (addressType === 'bitcoin') {
        if (walletType !== WALLET_TYPES.SPARK) {
          result.status = 'skipped'
          result.error = t('Requires Spark')
        } else {
          await provider.sendOnChain(address, result.amount)
          result.status = 'success'
        }
      } else {
        result.status = 'skipped'
        result.error = t('Unknown type')
      }

      // Update last used on success
      if (result.status === 'success') {
        await addressBookStore.updateLastUsed(result.contact.id)
      }
    } catch (error) {
      result.status = 'failed'
      result.error = error.message || t('Payment failed')
    }

    // Small delay for UI feedback
    await new Promise(r => setTimeout(r, 300))
  }

  isExecuting.value = false

  // Auto-advance to summary
  if (isComplete.value || isCancelled.value) {
    step.value = 5
  }

  // Refresh wallet balance
  if (walletStore.activeWalletId) {
    walletStore.refreshWalletData(walletStore.activeWalletId)
  }
}

function cancelBatch() {
  isCancelled.value = true
  // Mark remaining as skipped
  for (const result of paymentResults.value) {
    if (result.status === 'pending') {
      result.status = 'skipped'
      result.error = t('Cancelled')
    }
  }
  step.value = 5
}

function retryFailed() {
  // Pre-select failed contacts
  selectedContacts.value = failedResults.value.map(r => r.contact)
  step.value = 1
  paymentResults.value = []
}
</script>

<style scoped>
/* ════════════════════════════════════════════════════════════
   Theme Variables
   ════════════════════════════════════════════════════════════ */
.theme-dark {
  --c-bg: #1c1c1e;
  --c-bg2: #2c2c2e;
  --c-bg3: #3a3a3c;
  --c-text: #fff;
  --c-text2: #a1a1a6;
  --c-text3: #636366;
  --c-border: rgba(255,255,255,.08);
  --c-success: #15DE72;
  --c-warning: #F59E0B;
  --c-error: #EF4444;
}
.theme-light {
  --c-bg: #fff;
  --c-bg2: #f2f2f7;
  --c-bg3: #e5e5ea;
  --c-text: #1c1c1e;
  --c-text2: #8e8e93;
  --c-text3: #aeaeb2;
  --c-border: rgba(0,0,0,.06);
  --c-success: #15DE72;
  --c-warning: #F59E0B;
  --c-error: #EF4444;
}

/* ════════════════════════════════════════════════════════════
   Modal Card
   ════════════════════════════════════════════════════════════ */
.batch-modal {
  width: 100%;
  max-width: 500px;
  border-radius: 20px 20px 0 0;
  background: var(--c-bg);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Fustat', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* ════════════════════════════════════════════════════════════
   Header
   ════════════════════════════════════════════════════════════ */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.header-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.header-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--c-text);
}

.close-btn {
  width: 32px !important;
  height: 32px !important;
  min-width: 32px !important;
  min-height: 32px !important;
  padding: 0 !important;
  border-radius: 50% !important;
  background: var(--c-bg2) !important;
  color: var(--c-text2) !important;
  align-self: flex-start;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: var(--c-bg3) !important;
  color: var(--c-text) !important;
}

.close-btn :deep(.q-icon) {
  font-size: 18px !important;
}

.close-btn :deep(.q-btn__content) {
  padding: 0;
}

/* Step Indicator */
.step-indicator {
  display: flex;
  gap: 8px;
}

.step-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.step-completed {
  background: var(--c-success);
  color: #fff;
}

.step-current {
  background: var(--c-success);
  color: #fff;
  transform: scale(1.1);
}

.step-future {
  background: transparent;
  border: 2px solid var(--c-text3);
  color: var(--c-text3);
}

/* ════════════════════════════════════════════════════════════
   Body
   ════════════════════════════════════════════════════════════ */
.modal-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.step-content {
  padding: 20px;
}

/* ════════════════════════════════════════════════════════════
   Step 1: Contact Selection
   ════════════════════════════════════════════════════════════ */
.selection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.selection-count {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.count-number {
  font-size: 28px;
  font-weight: 700;
  color: var(--c-success);
}

.count-label {
  font-size: 14px;
  color: var(--c-text2);
}

.selection-actions {
  display: flex;
  gap: 8px;
}

.action-link {
  color: var(--c-success) !important;
  font-weight: 500;
}

/* Search */
.search-container {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--c-bg2);
  border-radius: 12px;
  margin-bottom: 16px;
}

.search-icon {
  font-size: 18px;
  color: var(--c-text3);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  font-family: inherit;
  color: var(--c-text);
}

.search-input::placeholder {
  color: var(--c-text3);
}

.clear-icon {
  font-size: 18px;
  color: var(--c-text3);
  cursor: pointer;
}

/* Contact List */
.contact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 350px;
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--c-bg2);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.contact-item:hover {
  background: var(--c-bg3);
}

.contact-selected {
  background: rgba(21, 222, 114, 0.1) !important;
  border: 1px solid rgba(21, 222, 114, 0.3);
}

.contact-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Checkbox */
.contact-checkbox {
  flex-shrink: 0;
}

.checkbox-box {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 2px solid var(--c-text3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.checkbox-checked {
  background: var(--c-success);
  border-color: var(--c-success);
  color: #fff;
}

.checkbox-checked i {
  font-size: 14px;
}

/* Avatar with Type Indicator */
.avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.contact-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}

.type-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--c-bg);
  color: #fff;
}

.type-dot i {
  font-size: 10px;
}

.type-dot svg {
  width: 10px;
  height: 10px;
}

.type-dot-sm {
  width: 16px;
  height: 16px;
}

.type-dot-sm i {
  font-size: 8px;
}

.type-dot-sm svg {
  width: 8px;
  height: 8px;
}

/* Info */
.contact-info {
  flex: 1;
  min-width: 0;
}

.contact-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--c-text);
  display: flex;
  align-items: center;
  gap: 4px;
}

.favorite-star {
  color: #F59E0B;
  font-size: 12px;
}

.contact-address {
  font-size: 12px;
  color: var(--c-text3);
  font-family: 'SF Mono', monospace;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px;
  color: var(--c-text3);
}

.empty-state i {
  font-size: 32px;
}

/* Warning Banner */
.warning-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 10px;
  margin-top: 16px;
  color: #F59E0B;
  font-size: 13px;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  margin-top: 16px;
  color: #EF4444;
  font-size: 13px;
}

/* ════════════════════════════════════════════════════════════
   Step 2: Amount Entry
   ════════════════════════════════════════════════════════════ */

/* Recipients Summary */
.recipients-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--c-bg2);
  border-radius: 12px;
  margin-bottom: 16px;
}

.recipients-avatars {
  display: flex;
}

.mini-avatar-wrap {
  position: relative;
  margin-left: -8px;
}

.mini-avatar-wrap:first-child {
  margin-left: 0;
}

.mini-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  border: 2px solid var(--c-bg);
}

.mini-type-dot {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--c-bg);
  color: #fff;
}

.mini-type-dot i {
  font-size: 7px;
}

.mini-type-dot svg {
  width: 6px;
  height: 6px;
}

.more-count {
  background: var(--c-text3) !important;
  font-size: 10px;
}

.recipients-text {
  font-size: 14px;
  color: var(--c-text);
  font-weight: 500;
}

/* Amount Input */
.amount-input-section {
  margin-bottom: 24px;
}

.input-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text2);
  margin-bottom: 8px;
}

.amount-input-wrap {
  display: flex;
  align-items: center;
  background: var(--c-bg2);
  border-radius: 12px;
  padding: 4px;
}

.amount-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 32px;
  font-weight: 600;
  font-family: inherit;
  color: var(--c-text);
  padding: 12px 16px;
  text-align: left;
}

.amount-input::placeholder {
  color: var(--c-text3);
}

.currency-toggle {
  padding: 10px 16px;
  background: var(--c-bg3);
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.currency-toggle:hover {
  background: var(--c-success);
  color: #000;
}

.amount-conversion {
  font-size: 14px;
  color: var(--c-text3);
  margin-top: 8px;
  text-align: center;
}

/* Balance Section */
.balance-section {
  background: var(--c-bg2);
  border-radius: 12px;
  padding: 16px;
}

.balance-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
}

.balance-row:not(:last-child) {
  border-bottom: 1px solid var(--c-border);
}

.balance-label {
  font-size: 14px;
  color: var(--c-text2);
}

.balance-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
  font-family: 'SF Mono', monospace;
}

.total-row .balance-label,
.total-row .balance-value {
  font-size: 15px;
}

.value-warning {
  color: var(--c-warning);
}

.value-error {
  color: var(--c-error);
}

/* Mode Toggle */
.mode-toggle {
  display: flex;
  gap: 8px;
  padding: 4px;
  background: var(--c-bg2);
  border-radius: 12px;
  margin-bottom: 20px;
}

.mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--c-text2);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-btn i {
  font-size: 14px;
}

.mode-btn.mode-active {
  background: var(--c-success);
  color: #000;
}

/* Calculation Preview */
.calc-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(135deg, rgba(21, 222, 114, 0.08) 0%, rgba(21, 222, 114, 0.04) 100%);
  border: 1px solid rgba(21, 222, 114, 0.2);
  border-radius: 12px;
  margin-bottom: 20px;
}

.calc-breakdown {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.calc-per-person {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text);
  font-family: 'SF Mono', monospace;
}

.calc-multiply {
  font-size: 12px;
  color: var(--c-text2);
}

.calc-equals {
  font-size: 20px;
  color: var(--c-text3);
  font-weight: 300;
}

.calc-result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.calc-total-sats {
  font-size: 18px;
  font-weight: 700;
  color: var(--c-success);
  font-family: 'SF Mono', monospace;
}

.calc-total-fiat {
  font-size: 12px;
  color: var(--c-text2);
}

/* Quick Fill */
.quick-fill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--c-bg2);
  border-radius: 10px;
  margin-bottom: 12px;
}

.quick-fill-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--c-text);
  font-family: inherit;
}

.quick-fill-input::placeholder {
  color: var(--c-text3);
}

.quick-fill-btn {
  color: var(--c-success);
  font-size: 13px;
  font-weight: 600;
}

.quick-fill-btn:disabled {
  color: var(--c-text3);
}

/* Custom Amounts List */
.custom-amounts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  margin-bottom: 20px;
}

.custom-amount-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--c-bg2);
  border-radius: 10px;
}

.custom-contact {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.custom-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.custom-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.custom-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--c-bg3);
  border-radius: 8px;
  padding: 6px 10px;
}

.custom-input {
  width: 80px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  font-family: 'SF Mono', monospace;
  color: var(--c-text);
  text-align: right;
}

.custom-input::placeholder {
  color: var(--c-text3);
}

.custom-unit {
  font-size: 12px;
  color: var(--c-text3);
  font-weight: 500;
}

/* Custom Mode Total Preview */
.custom-total-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(21, 222, 114, 0.08) 0%, rgba(21, 222, 114, 0.04) 100%);
  border: 1px solid rgba(21, 222, 114, 0.2);
  border-radius: 10px;
  margin-bottom: 16px;
}

.custom-total-label {
  font-size: 14px;
  color: var(--c-text2);
}

.custom-total-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--c-success);
  font-family: 'SF Mono', monospace;
}

.custom-total-fiat {
  font-size: 13px;
  color: var(--c-text2);
}

/* Balance Card */
.balance-card {
  background: var(--c-bg2);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.balance-card.balance-warning {
  border-color: rgba(245, 158, 11, 0.3);
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, var(--c-bg2) 100%);
}

.balance-card.balance-error {
  border-color: rgba(239, 68, 68, 0.3);
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.05) 0%, var(--c-bg2) 100%);
}

.balance-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--c-text2);
  font-size: 13px;
  font-weight: 500;
}

.balance-header i {
  font-size: 16px;
}

.balance-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.balance-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.balance-item .balance-label {
  font-size: 14px;
  color: var(--c-text2);
}

.balance-item .balance-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
  font-family: 'SF Mono', monospace;
}

.balance-sending .balance-value {
  color: var(--c-text2);
}

.balance-divider {
  height: 1px;
  background: var(--c-border);
  margin: 4px 0;
}

.balance-remaining .balance-label {
  font-weight: 500;
  color: var(--c-text);
}

.balance-remaining .balance-value {
  font-size: 15px;
}

/* Info Banner */
.info-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 10px;
  margin-top: 16px;
  color: #3B82F6;
  font-size: 13px;
}

/* ════════════════════════════════════════════════════════════
   Step 3: Review
   ════════════════════════════════════════════════════════════ */
.review-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  margin-bottom: 20px;
}

.review-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--c-bg2);
  border-radius: 12px;
}

.review-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.review-info {
  flex: 1;
  min-width: 0;
}

.review-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text);
}

.review-address {
  font-size: 11px;
  color: var(--c-text3);
  font-family: 'SF Mono', monospace;
}

.review-amount {
  text-align: right;
}

.amount-sats {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
}

.amount-fiat {
  font-size: 11px;
  color: var(--c-text3);
}

/* Fee Summary */
.fee-summary {
  background: var(--c-bg2);
  border-radius: 12px;
  padding: 16px;
}

.fee-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: var(--c-text2);
  padding: 6px 0;
}

.fee-total {
  border-top: 1px solid var(--c-border);
  margin-top: 8px;
  padding-top: 12px;
  font-weight: 600;
  color: var(--c-text);
}

/* ════════════════════════════════════════════════════════════
   Step 4: Execution
   ════════════════════════════════════════════════════════════ */
.progress-section {
  margin-bottom: 20px;
}

.progress-bar {
  height: 6px;
  background: var(--c-bg3);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--c-success);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 13px;
  color: var(--c-text2);
  text-align: center;
  margin-top: 8px;
}

.execution-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 350px;
  overflow-y: auto;
}

.execution-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--c-bg2);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.status-success {
  background: rgba(21, 222, 114, 0.08);
}

.status-failed,
.status-skipped {
  background: rgba(239, 68, 68, 0.08);
}

.exec-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.exec-info {
  flex: 1;
  min-width: 0;
}

.exec-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--c-text);
}

.exec-status {
  font-size: 12px;
}

.status-text {
  color: var(--c-text3);
}

.status-success {
  color: var(--c-success) !important;
}

.status-failed {
  color: var(--c-error) !important;
}

.status-skipped {
  color: var(--c-warning) !important;
}

.exec-amount {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text2);
  font-family: 'SF Mono', monospace;
}

.exec-icon {
  width: 24px;
  display: flex;
  justify-content: center;
}

.icon-success {
  font-size: 20px;
  color: var(--c-success);
}

.icon-failed {
  font-size: 20px;
  color: var(--c-error);
}

.icon-skipped {
  font-size: 20px;
  color: var(--c-warning);
}

.icon-pending {
  font-size: 18px;
  color: var(--c-text3);
}

.cancel-btn {
  width: 100%;
  margin-top: 16px;
  color: var(--c-error) !important;
}

/* ════════════════════════════════════════════════════════════
   Step 5: Summary
   ════════════════════════════════════════════════════════════ */
.summary-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 20px 0;
}

.summary-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.summary-icon i {
  font-size: 48px;
}

.icon-success {
  background: rgba(21, 222, 114, 0.1);
  color: var(--c-success);
}

.icon-partial {
  background: rgba(245, 158, 11, 0.1);
  color: var(--c-warning);
}

.summary-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--c-text);
  margin: 0 0 16px;
}

.summary-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 500;
}

.stat-success {
  color: var(--c-success);
}

.stat-failed {
  color: var(--c-error);
}

.summary-total {
  font-size: 16px;
  color: var(--c-text2);
  margin-bottom: 20px;
}

.summary-total strong {
  color: var(--c-text);
}

.failed-list {
  width: 100%;
  text-align: left;
  background: rgba(239, 68, 68, 0.05);
  border-radius: 12px;
  padding: 16px;
}

.failed-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-error);
  margin-bottom: 12px;
}

.failed-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 6px 0;
  border-bottom: 1px solid var(--c-border);
}

.failed-item:last-child {
  border-bottom: none;
}

.failed-name {
  color: var(--c-text);
  font-weight: 500;
}

.failed-error {
  color: var(--c-text3);
}

/* ════════════════════════════════════════════════════════════
   Footer
   ════════════════════════════════════════════════════════════ */
.modal-footer {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}

.btn-secondary {
  flex: 1;
  padding: 14px;
  font-size: 15px;
  font-weight: 600;
  color: var(--c-text2);
  border-radius: 12px;
}

.btn-primary {
  flex: 2;
  padding: 14px;
  font-size: 15px;
  font-weight: 600;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #000 !important;
  border-radius: 12px;
}

.btn-primary:disabled {
  opacity: 0.4;
}

/* ════════════════════════════════════════════════════════════
   Responsive
   ════════════════════════════════════════════════════════════ */
@media (max-width: 480px) {
  .batch-modal {
    max-height: 90vh;
  }

  .step-content {
    padding: 16px;
  }

  .amount-input {
    font-size: 28px;
  }

  .contact-list,
  .execution-list,
  .review-list {
    max-height: 280px;
  }
}

/* ════════════════════════════════════════════════════════════
   Confirmation Dialog
   ════════════════════════════════════════════════════════════ */
.confirm-dialog {
  background: var(--c-bg);
  border-radius: 20px;
  padding: 28px 24px 24px;
  text-align: center;
  max-width: 320px;
  width: 90vw;
}

.confirm-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.confirm-icon i {
  font-size: 28px;
  color: var(--c-error);
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--c-text);
  margin: 0 0 8px;
}

.confirm-message {
  font-size: 14px;
  color: var(--c-text2);
  margin: 0 0 24px;
  line-height: 1.4;
}

.confirm-actions {
  display: flex;
  gap: 12px;
}

.confirm-btn {
  flex: 1;
  padding: 12px 16px;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.confirm-btn-cancel {
  background: var(--c-bg2);
  color: var(--c-text);
}

.confirm-btn-cancel:hover {
  background: var(--c-bg3);
}

.confirm-btn-confirm {
  background: var(--c-error);
  color: #fff;
}

.confirm-btn-confirm:hover {
  opacity: 0.9;
}
</style>
