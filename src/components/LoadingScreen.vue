<template>
  <div
    v-if="visible"
    class="loading-screen"
    :class="{
      'fade-out': !show,
      'loading-screen-dark': $q.dark.isActive,
      'loading-screen-light': !$q.dark.isActive
    }"
  >
    <div class="loading-container">
      <!-- Buho Logo -->
      <div class="logo-container">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="80"
          height="85"
          viewBox="0 0 30 32"
          fill="none"
          class="buho-logo"
          :class="{ 'pulse': show }"
        >
          <path
            d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z"
            fill="#059573"
            class="logo-part-1"
          />
          <path
            d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z"
            fill="#15DE72"
            class="logo-part-2"
          />
          <path
            d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z"
            fill="#43B65B"
            class="logo-part-3"
          />
        </svg>
      </div>

      <!-- App Name -->
      <div
        class="app-name"
        :class="$q.dark.isActive ? 'app-name-dark' : 'app-name-light'"
      >
        BuhoGO
      </div>

      <!-- Loading Indicator -->
      <div class="loading-indicator">
        <div class="loading-dots">
          <div class="dot dot-1"></div>
          <div class="dot dot-2"></div>
          <div class="dot dot-3"></div>
        </div>
      </div>

      <!-- Loading Text -->
      <div
        class="loading-text"
        :class="$q.dark.isActive ? 'loading-text-dark' : 'loading-text-light'"
        v-if="loadingText"
      >
        {{ loadingText }}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LoadingScreen',
  props: {
    show: {
      type: Boolean,
      default: true
    },
    loadingText: {
      type: String,
      default: 'Loading...'
    }
  },
  data() {
    return {
      visible: true
    }
  },
  watch: {
    show(newVal) {
      if (!newVal) {
        setTimeout(() => {
          this.visible = false;
        }, 600);
      } else {
        this.visible = true;
      }
    }
  }
}
</script>

<style scoped>
.loading-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: opacity 0.5s ease-out;
}

.loading-screen-dark {
  background: #0C0C0C;
}

.loading-screen-light {
  background: #FFF;
}

.loading-screen.fade-out {
  opacity: 0;
  pointer-events: none;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.logo-container {
  margin-bottom: 2rem;
  position: relative;
}

.buho-logo {
  filter: drop-shadow(0 4px 12px rgba(21, 222, 114, 0.3));
  transition: all 0.3s ease;
}

.buho-logo.pulse {
  animation: logo-pulse 2s ease-in-out infinite;
}

.app-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 2rem;
  font-weight: 800;
  line-height: 100%;
  background: linear-gradient(90deg, #059573 0%, #15DE72 50%, #78D53C 100%);
  background-size: 200% 200%;
  animation: gradientShift 3s ease-in-out infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 2rem;
}

.app-name-dark {
  /* Gradient text already handles dark mode well */
}

.app-name-light {
  /* Gradient text already handles light mode well */
}

@keyframes gradientShift {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

.loading-indicator {
  margin-bottom: 1rem;
}

.loading-dots {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #15DE72;
  animation: dot-bounce 1.4s ease-in-out infinite both;
}

.dot-1 {
  animation-delay: -0.32s;
}

.dot-2 {
  animation-delay: -0.16s;
}

.dot-3 {
  animation-delay: 0s;
}

.loading-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 100%;
}

.loading-text-dark {
  color: var(--Shark-300, #B0B0B0);
}

.loading-text-light {
  color: var(--Shark-600, #5D5D5D);
}

/* Animations */
@keyframes logo-pulse {
  0%, 100% {
    transform: scale(1);
    filter: drop-shadow(0 4px 12px rgba(21, 222, 114, 0.3));
  }
  50% {
    transform: scale(1.05);
    filter: drop-shadow(0 6px 16px rgba(21, 222, 114, 0.5));
  }
}

@keyframes dot-bounce {
  0%, 80%, 100% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  40% {
    transform: scale(1.2);
    opacity: 1;
  }
}

/* Responsive Design */
@media (max-width: 480px) {
  .buho-logo {
    width: 60px;
    height: 64px;
  }

  .app-name {
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .loading-container {
    padding: 1rem;
  }

  .logo-container {
    margin-bottom: 1.5rem;
  }
}

/* Light mode specific adjustments */
@media (prefers-color-scheme: light) {
  .loading-screen-light .buho-logo {
    filter: drop-shadow(0 4px 12px rgba(21, 222, 114, 0.2));
  }

  .loading-screen-light .buho-logo.pulse {
    animation: logo-pulse-light 2s ease-in-out infinite;
  }
}

@keyframes logo-pulse-light {
  0%, 100% {
    transform: scale(1);
    filter: drop-shadow(0 4px 12px rgba(21, 222, 114, 0.2));
  }
  50% {
    transform: scale(1.05);
    filter: drop-shadow(0 6px 16px rgba(21, 222, 114, 0.4));
  }
}
</style>
