<!--
  AddressBookQuickModal
  Quick access to contacts from the home screen.
  Horizontal swipeable favorites/recent + vertical all contacts list.
-->
<template>
  <q-dialog
    v-model="isVisible"
    position="bottom"
    @show="onShow"
  >
    <q-card class="modal-card" :class="themeClass">
      <!-- Header -->
      <header class="modal-header">
        <div class="header-left">
          <i class="las la-address-book header-icon"></i>
          <h2 class="header-title">{{ $t('Contacts') }}</h2>
        </div>
        <q-btn flat round dense icon="las la-times" class="close-btn" @click="close" />
      </header>

      <!-- Content -->
      <main class="modal-body">
        <!-- Loading State -->
        <div v-if="isLoading" class="loading-state">
          <q-spinner-dots size="32px" color="green" />
        </div>

        <!-- Empty State -->
        <div v-else-if="!hasContacts" class="empty-state">
          <div class="empty-circle">
            <i class="las la-user-plus"></i>
          </div>
          <p class="empty-title">{{ $t('No contacts yet') }}</p>
          <p class="empty-subtitle">{{ $t('Add contacts to quickly send payments') }}</p>
          <q-btn unelevated no-caps class="btn-primary" @click="goToAddressBook">
            <i class="las la-plus q-mr-sm"></i>
            {{ $t('Add Contact') }}
          </q-btn>
        </div>

        <!-- Contact Sections -->
        <div v-else class="sections-container">
          <!-- Favorites Section (Horizontal Scroll) -->
          <section v-if="favoriteContacts.length > 0" class="horizontal-section">
            <div class="section-header">
              <div class="section-title">
                <i class="las la-star title-icon title-icon--gold"></i>
                <span>{{ $t('Favorites') }}</span>
              </div>
              <span class="section-count">{{ favoriteContacts.length }}</span>
            </div>
            <div class="horizontal-scroll">
              <div class="scroll-track">
                <button
                  v-for="contact in favoriteContacts"
                  :key="contact.id"
                  type="button"
                  class="contact-chip"
                  :class="themeClass"
                  @click="selectContact(contact)"
                >
                  <div class="chip-avatar-wrap">
                    <div class="chip-avatar" :style="{ background: contact.color || '#3B82F6' }">
                      <span class="avatar-letter">{{ getInitial(contact.name) }}</span>
                    </div>
                    <div class="chip-type-dot" :style="{ background: getTypeColor(contact.addressType) }">
                      <svg v-if="contact.addressType === 'spark'" width="10" height="10" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
                      </svg>
                      <i v-else :class="getTypeIcon(contact.addressType)"></i>
                    </div>
                  </div>
                  <span class="chip-name">{{ truncateName(contact.name, 9) }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- Recent Section (Horizontal Scroll) -->
          <section v-if="recentContacts.length > 0" class="horizontal-section">
            <div class="section-header">
              <div class="section-title">
                <i class="las la-clock title-icon title-icon--blue"></i>
                <span>{{ $t('Recent') }}</span>
              </div>
              <span class="section-count">{{ recentContacts.length }}</span>
            </div>
            <div class="horizontal-scroll">
              <div class="scroll-track">
                <button
                  v-for="contact in recentContacts"
                  :key="contact.id"
                  type="button"
                  class="contact-chip"
                  :class="themeClass"
                  @click="selectContact(contact)"
                >
                  <div class="chip-avatar-wrap">
                    <div class="chip-avatar" :style="{ background: contact.color || '#3B82F6' }">
                      <span class="avatar-letter">{{ getInitial(contact.name) }}</span>
                    </div>
                    <div class="chip-type-dot" :style="{ background: getTypeColor(contact.addressType) }">
                      <svg v-if="contact.addressType === 'spark'" width="10" height="10" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
                      </svg>
                      <i v-else :class="getTypeIcon(contact.addressType)"></i>
                    </div>
                  </div>
                  <span class="chip-name">{{ truncateName(contact.name, 9) }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- All Contacts Section (Vertical List) -->
          <section class="vertical-section">
            <div class="section-header">
              <div class="section-title">
                <i class="las la-users title-icon"></i>
                <span>{{ $t('All Contacts') }}</span>
              </div>
              <span class="section-count">{{ allContacts.length }}</span>
            </div>

            <!-- Search -->
            <div class="search-bar" :class="themeClass">
              <i class="las la-search search-icon"></i>
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="$t('Search...')"
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
              <template v-if="filteredContacts.length > 0">
                <button
                  v-for="contact in filteredContacts"
                  :key="contact.id"
                  type="button"
                  class="contact-row"
                  :class="themeClass"
                  @click="selectContact(contact)"
                >
                  <div class="row-avatar" :style="{ background: contact.color || '#3B82F6' }">
                    <span class="avatar-letter">{{ getInitial(contact.name) }}</span>
                  </div>
                  <div class="row-details">
                    <div class="row-name">
                      {{ contact.name }}
                      <i v-if="contact.isFavorite" class="las la-star star-icon"></i>
                    </div>
                    <div class="row-meta">
                      <span
                        class="type-badge"
                        :class="{ 'type-badge--spark': contact.addressType === 'spark' }"
                        :style="contact.addressType !== 'spark' ? {
                          background: getTypeBgColor(contact.addressType),
                          color: getTypeColor(contact.addressType)
                        } : {}"
                      >
                        <svg v-if="contact.addressType === 'spark'" width="10" height="10" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="white"/>
                        </svg>
                        <i v-else :class="getTypeIcon(contact.addressType)"></i>
                        <span>{{ contact.addressType || 'lightning' }}</span>
                      </span>
                      <span class="row-address">{{ truncateAddress(contact.address || contact.lightningAddress) }}</span>
                    </div>
                  </div>
                  <i class="las la-angle-right row-arrow"></i>
                </button>
              </template>
              <div v-else class="no-results">
                <i class="las la-search"></i>
                <span>{{ $t('No results') }}</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      <!-- Footer -->
      <footer class="modal-footer">
        <q-btn flat no-caps class="btn-footer btn-batch" @click="openBatchSend">
          <i class="las la-layer-group q-mr-sm"></i>
          <span>{{ $t('Batch Send') }}</span>
        </q-btn>
        <q-btn flat no-caps class="btn-footer" @click="goToAddressBook">
          <span>{{ $t('Manage Contacts') }}</span>
          <i class="las la-external-link-alt q-ml-sm"></i>
        </q-btn>
      </footer>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import { useAddressBookStore } from '../stores/addressBook';

// ─────────────────────────────────────────────────────────────
// Props / Emits
// ─────────────────────────────────────────────────────────────
const props = defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue', 'pay-contact', 'open-batch-send']);

// ─────────────────────────────────────────────────────────────
// Composables
// ─────────────────────────────────────────────────────────────
const $q = useQuasar();
const router = useRouter();
const addressBookStore = useAddressBookStore();

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
const searchQuery = ref('');
const isLoading = ref(false);

// ─────────────────────────────────────────────────────────────
// Computed
// ─────────────────────────────────────────────────────────────
const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
});

const themeClass = computed(() => $q.dark.isActive ? 'theme-dark' : 'theme-light');
const hasContacts = computed(() => addressBookStore.entries.length > 0);

const allContacts = computed(() =>
  [...addressBookStore.entries].sort((a, b) => a.name.localeCompare(b.name))
);

const favoriteContacts = computed(() => addressBookStore.favoriteEntries);
const recentContacts = computed(() => addressBookStore.recentEntries);

const filteredContacts = computed(() => {
  if (!searchQuery.value.trim()) return allContacts.value;
  const q = searchQuery.value.toLowerCase();
  return allContacts.value.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.address || c.lightningAddress || '').toLowerCase().includes(q)
  );
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getInitial(name) {
  return name ? name.charAt(0).toUpperCase() : '?';
}

function truncateName(name, max) {
  if (!name) return '';
  return name.length > max ? name.slice(0, max) + '…' : name;
}

function truncateAddress(addr) {
  if (!addr) return '';
  if (addr.length <= 20) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function getTypeIcon(type) {
  const icons = {
    lightning: 'las la-bolt',
    spark: 'spark-logo', // Special case - uses SVG
    bitcoin: 'lab la-bitcoin'
  };
  return icons[type] || icons.lightning;
}

function isSparkType(type) {
  return type === 'spark';
}

function getTypeColor(type) {
  const colors = {
    lightning: '#F59E0B',
    spark: '#000', // Black background for Spark
    bitcoin: '#F7931A'
  };
  return colors[type] || colors.lightning;
}

function getTypeBgColor(type) {
  const colors = {
    lightning: 'rgba(245,158,11,.12)',
    spark: '#000', // Black background for Spark
    bitcoin: 'rgba(247,147,26,.12)'
  };
  return colors[type] || colors.lightning;
}

// ─────────────────────────────────────────────────────────────
// Methods
// ─────────────────────────────────────────────────────────────
async function onShow() {
  isLoading.value = true;
  searchQuery.value = '';
  try {
    await addressBookStore.initialize();
  } catch (e) {
    console.error('Failed to load contacts:', e);
  } finally {
    isLoading.value = false;
  }
}

function selectContact(contact) {
  addressBookStore.updateLastUsed(contact.id);
  emit('pay-contact', contact);
}

function goToAddressBook() {
  isVisible.value = false;
  router.push('/address-book');
}

function openBatchSend() {
  isVisible.value = false;
  emit('open-batch-send');
}

function close() {
  isVisible.value = false;
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
}
.theme-light {
  --c-bg: #fff;
  --c-bg2: #f2f2f7;
  --c-bg3: #e5e5ea;
  --c-text: #1c1c1e;
  --c-text2: #8e8e93;
  --c-text3: #aeaeb2;
  --c-border: rgba(0,0,0,.06);
}

/* ════════════════════════════════════════════════════════════
   Modal Card
   ════════════════════════════════════════════════════════════ */
.modal-card {
  width: 100%;
  max-width: 500px;
  border-radius: 20px 20px 0 0;
  background: var(--c-bg);
  max-height: 80vh;
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
  padding: 18px 20px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}
.header-left { display: flex; align-items: center; gap: 10px; }
.header-icon { font-size: 22px; color: #15DE72; }
.header-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--c-text); }
.close-btn { color: var(--c-text2); }

/* ════════════════════════════════════════════════════════════
   Body
   ════════════════════════════════════════════════════════════ */
.modal-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 200px;
}

/* ════════════════════════════════════════════════════════════
   Loading & Empty States
   ════════════════════════════════════════════════════════════ */
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}
.empty-circle {
  width: 80px; height: 80px;
  border-radius: 50%;
  background: var(--c-bg2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--c-text3);
  font-size: 36px;
  margin-bottom: 20px;
}
.empty-title { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: var(--c-text); }
.empty-subtitle { margin: 0 0 24px; font-size: 14px; color: var(--c-text2); max-width: 260px; line-height: 1.5; }

.btn-primary {
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 600;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #fff !important;
  border-radius: 12px;
}

/* ════════════════════════════════════════════════════════════
   Sections
   ════════════════════════════════════════════════════════════ */
.sections-container { padding-bottom: 8px; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 6px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--c-text2);
}
.title-icon { font-size: 13px; color: var(--c-text3); }
.title-icon--gold { color: #F59E0B; }
.title-icon--blue { color: #3B82F6; }
.section-count {
  font-size: 11px;
  font-weight: 500;
  color: var(--c-text3);
  background: var(--c-bg2);
  padding: 2px 8px;
  border-radius: 8px;
}

/* ════════════════════════════════════════════════════════════
   Horizontal Scroll
   ════════════════════════════════════════════════════════════ */
.horizontal-section { margin-bottom: 4px; }
.horizontal-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.horizontal-scroll::-webkit-scrollbar { display: none; }
.scroll-track {
  display: flex;
  gap: 8px;
  padding: 2px 20px 10px;
}

/* ════════════════════════════════════════════════════════════
   Contact Chip (Horizontal) - Compact
   ════════════════════════════════════════════════════════════ */
.contact-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 10px 8px 8px;
  min-width: 58px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  transition: transform .15s, box-shadow .15s;
  flex-shrink: 0;
}
.contact-chip.theme-dark { background: #2a2a2c; }
.contact-chip.theme-light { background: #f5f5f7; }
.contact-chip:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,.15); }
.contact-chip:active { transform: scale(0.96); }

.chip-avatar-wrap { position: relative; }
.chip-avatar {
  width: 35px; height: 35px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0,0,0,.15);
}
.avatar-letter {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.chip-type-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 14px; height: 14px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--c-bg);
  font-size: 7px;
  color: #fff;
}
.chip-type-dot svg {
  width: 7px;
  height: 7px;
}
.chip-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--c-text);
  max-width: 54px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ════════════════════════════════════════════════════════════
   Vertical Section
   ════════════════════════════════════════════════════════════ */
.vertical-section {
  border-top: 1px solid var(--c-border);
  padding-top: 4px;
}

/* ════════════════════════════════════════════════════════════
   Search Bar
   ════════════════════════════════════════════════════════════ */
.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 14px;
  padding: 11px 14px;
  border-radius: 12px;
}
.search-bar.theme-dark { background: #2a2a2c; }
.search-bar.theme-light { background: #f0f0f2; }
.search-icon { font-size: 16px; color: var(--c-text3); }
.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  font-family: inherit;
  color: var(--c-text);
}
.search-input::placeholder { color: var(--c-text3); }
.clear-icon { font-size: 16px; color: var(--c-text3); cursor: pointer; }
.clear-icon:hover { color: var(--c-text2); }

/* ════════════════════════════════════════════════════════════
   Contact List
   ════════════════════════════════════════════════════════════ */
.contact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px;
  max-height: 300px;
  overflow-y: auto;
}

/* ════════════════════════════════════════════════════════════
   Contact Row
   ════════════════════════════════════════════════════════════ */
.contact-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: background .15s, transform .1s;
  font-family: inherit;
}
.contact-row.theme-dark { background: #2a2a2c; }
.contact-row.theme-light { background: #f5f5f7; }
.contact-row:hover.theme-dark { background: #333; }
.contact-row:hover.theme-light { background: #ebebed; }
.contact-row:active { transform: scale(0.98); }

.row-avatar {
  width: 44px; height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
}
.row-avatar .avatar-letter { font-size: 18px; }

.row-details { flex: 1; min-width: 0; }
.row-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 500;
  color: var(--c-text);
  margin-bottom: 4px;
}
.star-icon { font-size: 12px; color: #F59E0B; }

.row-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: capitalize;
}
.type-badge i { font-size: 11px; }
.type-badge--spark {
  background: #000 !important;
  color: #fff !important;
}
.type-badge--spark svg { flex-shrink: 0; }
.row-address {
  font-size: 13px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  color: var(--c-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-arrow { font-size: 16px; color: var(--c-text3); flex-shrink: 0; }

/* ════════════════════════════════════════════════════════════
   No Results
   ════════════════════════════════════════════════════════════ */
.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 16px;
  color: var(--c-text3);
  font-size: 14px;
}
.no-results i { font-size: 28px; opacity: 0.5; }

/* ════════════════════════════════════════════════════════════
   Footer
   ════════════════════════════════════════════════════════════ */
.modal-footer {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  padding-bottom: max(14px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}
.btn-footer {
  flex: 1;
  padding: 12px;
  font-size: 14px;
  font-weight: 500;
  color: #15DE72;
  border-radius: 12px;
  justify-content: center;
}
.btn-footer:hover { background: rgba(21,222,114,.08); }
.btn-batch {
  background: rgba(21,222,114,.1);
}
</style>
