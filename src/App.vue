<template>
  <!-- Biometric lock overlay -->
  <div v-if="locked" class="biometric-lock" :class="isDark ? 'biometric-lock-dark' : 'biometric-lock-light'">
    <div class="biometric-lock-content">
      <div class="biometric-lock-icon" :class="isDark ? 'biometric-lock-icon-dark' : 'biometric-lock-icon-light'">
        <q-icon name="lock" size="32px" />
      </div>
      <p class="biometric-lock-title" :class="isDark ? 'biometric-lock-title-dark' : 'biometric-lock-title-light'">BuhoGO</p>
      <p class="biometric-lock-hint">{{ $t('Tap to unlock') }}</p>
      <button class="biometric-lock-btn" @click="promptUnlock">
        <q-icon name="fingerprint" size="28px" />
      </button>
    </div>
  </div>

  <router-view />
</template>

<script>
import { defineComponent, ref, onMounted, onUnmounted } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useQuasar } from 'quasar'
import { useWalletStore } from 'src/stores/wallet'
import { authenticate as biometricAuth } from 'src/utils/biometric'

export default defineComponent({
  name: 'App',

  setup () {
    const store = useWalletStore()
    const $q = useQuasar()
    const locked = ref(false)
    const isDark = ref($q.dark.isActive)
    let stateListener = null
    let isPrompting = false
    let lastPromptEnd = 0

    async function promptUnlock () {
      if (isPrompting) return
      isPrompting = true
      try {
        const passed = await biometricAuth({
          reason: 'Unlock BuhoGO',
          title: 'BuhoGO',
          subtitle: 'Verify your identity',
          useFallback: true
        })
        if (passed) {
          locked.value = false
        }
      } finally {
        lastPromptEnd = Date.now()
        isPrompting = false
      }
    }

    onMounted(async () => {
      if (!Capacitor.isNativePlatform()) return

      // Dynamic import — @capacitor/app is only available in Capacitor builds.
      // Must resolve BEFORE cold-start prompt to avoid race with appStateChange listener.
      const { App: CapApp } = await import('@capacitor/app')

      // Prompt biometric on cold start if enabled
      if (store.biometricsEnabled) {
        locked.value = true
        setTimeout(() => promptUnlock(), 300)
      }

      // Listen for background -> foreground transitions.
      // The biometric dialog itself causes a brief inactive->active cycle;
      // suppress it with isPrompting flag + 1.5s cooldown after last prompt.
      stateListener = await CapApp.addListener('appStateChange', ({ isActive }) => {
        if (!store.biometricsEnabled) return

        // Sync dark mode state for the lock overlay
        isDark.value = $q.dark.isActive

        if (!isActive) {
          // Ignore if biometric dialog is showing or just dismissed
          if (isPrompting || (Date.now() - lastPromptEnd < 1500)) return
          locked.value = true
        } else if (locked.value) {
          // Came back — only prompt if not still within the cooldown window
          if (isPrompting || (Date.now() - lastPromptEnd < 1500)) return
          setTimeout(() => promptUnlock(), 300)
        }
      })
    })

    onUnmounted(() => {
      if (stateListener) {
        stateListener.remove()
      }
    })

    return { locked, isDark, promptUnlock }
  }
})
</script>

<style>
.biometric-lock {
  position: fixed;
  inset: 0;
  z-index: 99999;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.biometric-lock-light {
  background: rgba(255, 255, 255, 0.97);
}
.biometric-lock-dark {
  background: rgba(18, 18, 18, 0.97);
}
.biometric-lock-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.biometric-lock-icon {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}
.biometric-lock-icon-light {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}
.biometric-lock-icon-dark {
  background: rgba(21, 222, 114, 0.15);
  color: #15DE72;
}
.biometric-lock-title {
  font-size: 22px;
  font-weight: 800;
  margin: 0;
}
.biometric-lock-title-light {
  color: #1e293b;
}
.biometric-lock-title-dark {
  color: #f1f5f9;
}
.biometric-lock-hint {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
}
.biometric-lock-btn {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #15DE72;
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 16px;
  box-shadow: 0 8px 24px rgba(21, 222, 114, 0.3);
  transition: transform 0.1s ease;
}
.biometric-lock-btn:active {
  transform: scale(0.93);
}
</style>
