<!--
  NotificationsSheet: everything BuhoGO may tell the person while they are in
  another app, opened from the Notifications row in Settings.

  One master switch on top ("Allow notifications"), which raises the system
  dialog. Only while it is on, the kinds below it appear, each with its own
  switch: received payments, and the contact chat's requests and messages
  (only where the chat runs). A kind is never shown on while the master
  switch is off. After an OS-level denial Android never asks again, so the
  caption says where to change it instead.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="store.syncPermission()"
  >
    <q-card class="notif-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="form-sheet-grabber" aria-hidden="true"></div>
      <header class="form-sheet-header">
        <span aria-hidden="true"></span>
        <h2 class="form-sheet-title">{{ $t('Notifications') }}</h2>
        <button type="button" class="form-sheet-cancel notif-done" @click="open = false">{{ $t('Done') }}</button>
      </header>

      <div class="notif-body">
        <SettingsSection>
          <SettingsRow icon="tabler:bell" :label="$t('Allow notifications')" :caption="masterCaption" :interactive="false">
            <template #right>
              <q-toggle :model-value="store.canNotify" :color="toggleColor" @update:model-value="setAllowed" />
            </template>
          </SettingsRow>
        </SettingsSection>

        <q-slide-transition>
          <div v-show="store.canNotify">
            <SettingsSection :title="$t('Notify me about')">
              <SettingsRow
                icon="tabler:arrow-down-left"
                :label="$t('Payments received')"
                :caption="$t('Money that lands in any of your wallets.')"
                :interactive="false"
              >
                <template #right>
                  <q-toggle :model-value="store.paymentsEnabled" :color="toggleColor" @update:model-value="store.setPaymentsEnabled" />
                </template>
              </SettingsRow>
              <SettingsRow
                v-if="chatAvailable"
                icon="tabler:message-circle"
                :label="$t('Requests and messages')"
                :caption="$t('When someone asks you for money or writes to you.')"
                :interactive="false"
              >
                <template #right>
                  <q-toggle :model-value="store.messagesEnabled" :color="toggleColor" @update:model-value="store.setMessagesEnabled" />
                </template>
              </SettingsRow>
            </SettingsSection>
          </div>
        </q-slide-transition>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance } from 'vue';
import { useQuasar } from 'quasar';
import { useNotificationsStore } from '../../stores/notifications.js';
import { useChatRuntime } from '../../composables/useChatRuntime.js';
import SettingsRow from './SettingsRow.vue';
import SettingsSection from './SettingsSection.vue';

const props = defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue']);

const $q = useQuasar();
// vue-i18n runs in legacy mode (src/boot/i18n.js), so useI18n() throws.
const { proxy } = getCurrentInstance();
const t = (key) => proxy.$t(key);
const store = useNotificationsStore();
const chatAvailable = useChatRuntime().available;

const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const toggleColor = computed(() => ($q.dark.isActive ? 'brand-green' : 'brand-green-dark'));
const masterCaption = computed(() => (store.permission === 'denied'
  ? t('Notifications are blocked for BuhoGO in your phone settings.')
  : t('While BuhoGO runs in the background.')));

async function setAllowed(value) {
  if (!value) {
    store.disable();
    return;
  }
  if (await store.enable()) return;
  $q.notify({
    message: store.permission === 'denied'
      ? t('Notifications are blocked for BuhoGO in your phone settings.')
      : t('Notifications not available'),
    color: 'warning',
    timeout: 3500,
  });
}
</script>

<style scoped>
.notif-card { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; padding-bottom: max(20px, var(--safe-bottom, 0px)); }
.notif-body { padding: 4px 16px 0; }
.notif-done { justify-self: end; font-weight: 600; }
</style>
