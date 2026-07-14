<!--
  ContactRestorePromptDialog

  Shown once, right after identity restore, when the address-book store's
  peekNostrContacts() finds contacts backed up on Nostr that aren't in the
  local address book yet. Purely presentational: it emits `confirm` and
  lets the parent (ProfilePage.vue) own the actual recoverFromNostr() call
  and its result toast, passing `loading` back down while that runs.

  Deliberately doesn't state a contact count — see the doc comment on
  peekNostrContacts() in stores/addressBook.js for why a number here
  could overpromise what the real merge delivers.
-->
<template>
  <q-dialog
    v-model="open"
    :persistent="loading"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="crp-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <q-card-section class="crp-body">
        <img
          src="/Onboarding wizard spark/storyset-online-friends-bro.svg"
          class="crp-illustration"
          alt=""
          aria-hidden="true"
        />
        <h2 class="crp-heading" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
          {{ $t('Add your contacts back?') }}
        </h2>
        <p class="crp-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          {{ $t('We found contacts saved from your Nostr profile. Add them to your address book?') }}
        </p>
      </q-card-section>

      <q-card-actions class="crp-actions">
        <q-btn
          unelevated
          no-caps
          class="crp-primary-btn"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :label="$t('Add contacts')"
          :loading="loading"
          @click="onConfirm"
        />
        <q-btn
          flat
          no-caps
          class="crp-secondary-btn"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          :label="$t('Not now')"
          :disable="loading"
          @click="open = false"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
export default {
  name: 'ContactRestorePromptDialog',

  props: {
    modelValue: { type: Boolean, default: false },
    /** Parent sets this true while the real recoverFromNostr() call runs. */
    loading: { type: Boolean, default: false },
  },

  emits: ['update:modelValue', 'confirm'],

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },
  },

  methods: {
    onConfirm() {
      this.$emit('confirm');
    },
  },
};
</script>

<style scoped>
.crp-card {
  width: 100%;
  max-width: 380px;
  border-radius: 20px;
}

.crp-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.75rem 1.5rem 0.5rem;
}

.crp-illustration {
  width: 100%;
  max-width: 190px;
  height: auto;
  margin: 4px auto 8px;
  user-select: none;
  pointer-events: none;
}

.crp-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  margin: 0 0 6px;
}

.crp-message {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
  max-width: 300px;
}

.crp-actions {
  padding: 1rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.crp-primary-btn,
.crp-secondary-btn {
  width: 100%;
  height: 46px;
  border-radius: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

.crp-secondary-btn {
  font-weight: 500;
}
</style>
