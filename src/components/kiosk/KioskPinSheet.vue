<!--
  KioskPinSheet: a new kiosk PIN, typed twice, in one bottom sheet (issue
  #449). Turning Kiosk Mode on and Change PIN both use it. The old PIN is
  never asked for: whoever is in the owner area got there with it, or with
  the forgotten-PIN taps in the register, the way a new Guided Access
  passcode is set in Settings without the old one.

  Emits `done` with the PIN once both entries match; the parent saves it.
  Closing the sheet any other way saves nothing.
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    transition-show="slide-up"
    transition-hide="slide-down"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @update:model-value="$emit('update:modelValue', $event)"
    @hide="reset"
  >
    <q-card class="kps-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="form-sheet-grabber" aria-hidden="true"></div>
      <header class="form-sheet-header">
        <button v-if="step === 'confirm'" type="button" class="form-sheet-cancel" @click="back">{{ $t('Back') }}</button>
        <span v-else aria-hidden="true"></span>
        <h2 class="form-sheet-title">{{ heading }}</h2>
        <button type="button" class="form-sheet-cancel kps-cancel" @click="$emit('update:modelValue', false)">{{ $t('Cancel') }}</button>
      </header>
      <div class="kps-body">
        <KioskPinPad
          ref="pad"
          :title="padTitle"
          :subtitle="step === 'enter' ? $t('You need this PIN to leave the register.') : ''"
          :error-message="error"
          @complete="onComplete"
        />
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import KioskPinPad from '../KioskPinPad.vue';

export default {
  name: 'KioskPinSheet',
  components: { KioskPinPad },
  props: {
    modelValue: { type: Boolean, default: false },
    /** The sheet's title: "Kiosk Mode" when turning it on, "Change PIN" otherwise. */
    heading: { type: String, required: true },
    /** Replacing a PIN rather than creating the first one. */
    changing: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'done'],
  data() {
    return { step: 'enter', first: '', error: '' };
  },
  computed: {
    padTitle() {
      if (this.step === 'enter') return this.changing ? this.$t('kiosk.enterNewPin') : this.$t('kiosk.setupPin');
      return this.changing ? this.$t('kiosk.confirmNewPin') : this.$t('kiosk.confirmPin');
    },
  },
  methods: {
    onComplete(pin) {
      if (this.step === 'enter') {
        this.first = pin;
        this.error = '';
        this.step = 'confirm';
        this.$nextTick(() => this.$refs.pad?.reset());
        return;
      }
      if (pin !== this.first) {
        // Start over: which of the two entries was mistyped is unknown.
        this.first = '';
        this.step = 'enter';
        this.error = this.$t('kiosk.pinMismatch');
        this.$refs.pad?.fail();
        return;
      }
      this.$emit('done', pin);
      this.$emit('update:modelValue', false);
    },
    back() {
      this.first = '';
      this.error = '';
      this.step = 'enter';
      this.$refs.pad?.reset();
    },
    reset() {
      this.step = 'enter';
      this.first = '';
      this.error = '';
      this.$refs.pad?.reset();
    },
  },
};
</script>

<style scoped>
.kps-card { width: 100%; max-width: 560px; margin: 0 auto; border-radius: 24px 24px 0 0; }
.kps-cancel { justify-self: end; }
/* The body pads the bottom: Quasar's own bottom-dialog padding wins over the card's. */
.kps-body { padding: 16px 24px max(24px, var(--safe-bottom, 0px)); }
</style>
