<template>
  <div class="pin-pad">
    <h2 class="pin-title" :class="dark ? 'text-white' : 'text-dark'">{{ title }}</h2>
    <p v-if="subtitle" class="pin-subtitle">{{ subtitle }}</p>

    <!-- Dot Indicators -->
    <div class="pin-dots" :class="{ 'pin-shake': shaking }">
      <div
        v-for="i in 4"
        :key="i"
        class="pin-dot"
        :class="{
          'pin-dot-filled': pin.length >= i,
          'pin-dot-error': hasError,
          'pin-dot-dark': dark
        }"
      />
    </div>

    <!-- Error Message -->
    <p v-if="errorMessage" class="pin-error">{{ errorMessage }}</p>
    <div v-else class="pin-error-spacer" />

    <!-- Keypad -->
    <div class="pin-keypad">
      <button
        v-for="btn in keypadButtons"
        :key="btn"
        class="pin-key"
        :class="{
          'pin-key-num': btn !== 'delete' && btn !== '',
          'pin-key-num-dark': dark && btn !== 'delete' && btn !== '',
          'pin-key-action': btn === 'delete',
          'pin-key-empty': btn === ''
        }"
        :disabled="btn === '' || disabled"
        @click="handleKey(btn)"
      >
        <q-icon v-if="btn === 'delete'" name="backspace" size="22px" />
        <span v-else>{{ btn }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, watch } from 'vue'
import { useQuasar } from 'quasar'

export default defineComponent({
  name: 'KioskPinPad',

  props: {
    title: { type: String, default: 'Enter PIN' },
    subtitle: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    disabled: { type: Boolean, default: false }
  },

  emits: ['complete'],

  setup(props, { emit, expose }) {
    const $q = useQuasar()
    const dark = $q.dark.isActive

    const pin = ref('')
    const shaking = ref(false)
    const hasError = ref(false)

    const keypadButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete']

    function handleKey(val) {
      if (props.disabled) return
      if (val === 'delete') {
        pin.value = pin.value.slice(0, -1)
        hasError.value = false
        return
      }
      if (pin.value.length >= 4) return
      pin.value += val
    }

    watch(pin, (val) => {
      if (val.length === 4) {
        emit('complete', val)
      }
    })

    watch(() => props.errorMessage, (msg) => {
      if (msg) {
        hasError.value = true
        shaking.value = true
        pin.value = ''
        setTimeout(() => { shaking.value = false }, 500)
      }
    })

    function reset() {
      pin.value = ''
      hasError.value = false
      shaking.value = false
    }

    expose({ reset })

    return { pin, shaking, hasError, keypadButtons, handleKey, reset, dark }
  }
})
</script>

<style scoped>
.pin-pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.pin-title {
  font-family: 'Manrope', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  margin: 0 0 0.25rem 0;
  text-align: center;
}

.pin-subtitle {
  font-size: 0.875rem;
  color: #94a3b8;
  margin: 0 0 2rem 0;
  text-align: center;
}

.pin-dots {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #cbd5e1;
  background: transparent;
  transition: all 0.2s ease;
}

.pin-dot-dark {
  border-color: #475569;
}

.pin-dot-filled {
  background: #15DE72;
  border-color: #15DE72;
}

.pin-dot-error {
  border-color: #ef4444;
}

.pin-dot-filled.pin-dot-error {
  background: #ef4444;
}

.pin-shake {
  animation: shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-8px); }
  20%, 40%, 60%, 80% { transform: translateX(8px); }
}

.pin-error {
  font-size: 0.8125rem;
  color: #ef4444;
  margin: 0 0 1rem 0;
  text-align: center;
  min-height: 1.25rem;
}

.pin-error-spacer {
  min-height: 1.25rem;
  margin-bottom: 1rem;
}

.pin-keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.625rem;
  width: 100%;
  max-width: 300px;
}

.pin-key {
  aspect-ratio: 1.5 / 1;
  border-radius: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Manrope', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  border: none;
  cursor: pointer;
}

.pin-key-num {
  background: #f1f5f9;
  color: #1e293b;
  border: 1px solid rgba(241, 245, 249, 0.8);
}

.pin-key-num:active {
  background: #e2e8f0;
  transform: scale(0.96);
}

.pin-key-num-dark {
  background: rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.pin-key-num-dark:active {
  background: rgba(255, 255, 255, 0.15);
  transform: scale(0.96);
}

.pin-key-action {
  background: transparent;
  color: #94a3b8;
}

.pin-key-action:active {
  color: #e2e8f0;
  transform: scale(0.96);
}

.pin-key-empty {
  background: transparent;
  cursor: default;
}

@media (max-height: 667px) {
  .pin-keypad { gap: 0.5rem; }
  .pin-key { aspect-ratio: 1.6 / 1; font-size: 1.25rem; border-radius: 0.875rem; }
  .pin-dots { margin-bottom: 0.5rem; }
  .pin-subtitle { margin-bottom: 1.5rem; }
}
</style>
