<template>
  <div class="loading-screen" :class="{ 'fade-out': !show }">
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
            fill="#78D53C"
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
      <div class="app-name">BuhoGO</div>
      
      <!-- Loading Indicator -->
      <div class="loading-indicator">
        <div class="loading-dots">
          <div class="dot dot-1"></div>
          <div class="dot dot-2"></div>
          <div class="dot dot-3"></div>
        </div>
      </div>
      
      <!-- Loading Text -->
      <div class="loading-text" v-if="loadingText">{{ loadingText }}</div>
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
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: opacity 0.5s ease-out;
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
  filter: drop-shadow(0 4px 12px rgba(5, 149, 115, 0.2));
  transition: all 0.3s ease;
}

.buho-logo.pulse {
  animation: logo-pulse 2s ease-in-out infinite;
}

.logo-part-1 {
  animation: part-fade-in 1.5s ease-out 0.2s both;
}

.logo-part-2 {
  animation: part-fade-in 1.5s ease-out 0.4s both;
}

.logo-part-3 {
  animation: part-fade-in 1.5s ease-out 0.6s both;
}

.app-name {
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #78D53C);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 2rem;
  opacity: 0;
  animation: text-fade-in 1s ease-out 0.8s both;
}

.loading-indicator {
  margin-bottom: 1rem;
  opacity: 0;
  animation: indicator-fade-in 0.5s ease-out 1.2s both;
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
  background: #059573;
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
  color: #6b7280;
  font-size: 1rem;
  font-weight: 500;
  opacity: 0;
  animation: text-fade-in 0.5s ease-out 1.4s both;
}

/* Animations */
@keyframes logo-pulse {
  0%, 100% {
    transform: scale(1);
    filter: drop-shadow(0 4px 12px rgba(5, 149, 115, 0.2));
  }
  50% {
    transform: scale(1.05);
    filter: drop-shadow(0 6px 16px rgba(5, 149, 115, 0.3));
  }
}

@keyframes part-fade-in {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.9);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes text-fade-in {
  0% {
    opacity: 0;
    transform: translateY(20px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes indicator-fade-in {
  0% {
    opacity: 0;
    transform: translateY(10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
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

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  .loading-screen {
    background: #1a1a1a;
  }
  
  .loading-text {
    color: #9ca3af;
  }
}
</style>