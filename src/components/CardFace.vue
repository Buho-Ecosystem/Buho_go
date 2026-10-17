<!--
  CardFace
  The tapped card as an object on screen: the card's logo, its name and the
  service that issued it. Shown from the moment a card touches the phone
  (wallet redeem sheet, kiosk pay screen), so the person always sees which
  card is in play.

  States: `reading` adds a light sheen while the card's service answers,
  `locked` greys the card and marks it with a lock. Decorative only: the
  surrounding screen carries the words a screen reader announces.
-->
<template>
  <div
    class="card-face"
    :class="{ 'card-face--reading': reading, 'card-face--locked': locked, 'card-face--small': small }"
    aria-hidden="true"
  >
    <div class="card-face-top">
      <img v-if="logo && !logoFailed" :src="logo" alt="" class="card-face-logo" @error="logoFailed = true" />
      <span v-else class="card-face-logo card-face-logo--blank"></span>
      <span v-if="locked" class="card-face-lock">
        <Icon icon="tabler:lock" width="16" height="16" />
      </span>
      <svg v-else class="card-face-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
        <path d="M7.5 9.2a4.2 4.2 0 0 1 0 5.6" />
        <path d="M11 6.6a8 8 0 0 1 0 10.8" />
        <path d="M14.5 4a11.8 11.8 0 0 1 0 16" />
      </svg>
    </div>
    <div class="card-face-bottom">
      <div class="card-face-name">{{ name }}</div>
      <div v-if="host" class="card-face-host">{{ host }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  name: { type: String, default: 'Bolt Card' },
  host: { type: String, default: '' },
  logo: { type: String, default: '/Social_Wallet_logos/BoltCard.png' },
  reading: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  small: { type: Boolean, default: false },
})

const logoFailed = ref(false)
watch(() => props.logo, () => { logoFailed.value = false })
</script>

<style scoped>
.card-face {
  position: relative;
  width: 100%;
  max-width: 280px;
  margin: 0 auto;
  aspect-ratio: 1.586;
  border-radius: 18px;
  padding: 16px 18px;
  color: #fff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background:
    radial-gradient(120% 90% at 85% 0%, rgba(255, 255, 255, 0.16), transparent 55%),
    linear-gradient(140deg, #26282B 0%, #3A3D41 55%, #1E1F21 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 12px 28px -12px rgba(0, 0, 0, 0.5);
  animation: card-arrive 0.5s cubic-bezier(0.2, 0.9, 0.25, 1.15) both;
  transition: filter 0.3s ease;
}

.card-face--small { max-width: 190px; padding: 11px 13px; border-radius: 13px; }

.card-face-top { display: flex; justify-content: space-between; align-items: center; }
.card-face-logo { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
.card-face--small .card-face-logo { width: 24px; height: 24px; }
.card-face-logo--blank { display: block; background: rgba(255, 255, 255, 0.15); }
.card-face-contactless { width: 24px; height: 24px; opacity: 0.85; }
.card-face--small .card-face-contactless { width: 17px; height: 17px; }

.card-face-lock {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
}

.card-face-name { font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 18px; letter-spacing: -0.01em; }
.card-face--small .card-face-name { font-size: 14px; }
.card-face-host { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px; opacity: 0.7; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-face--small .card-face-host { font-size: 9.5px; }

.card-face--locked { filter: grayscale(1) brightness(0.78); }

.card-face--reading::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.2) 50%, transparent 70%);
  animation: card-sheen 1.3s ease-in-out infinite;
}

@keyframes card-sheen { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@keyframes card-arrive { from { transform: translateY(20px) scale(0.95); opacity: 0; } to { transform: none; opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .card-face { animation: none; }
  .card-face--reading::after { animation: none; opacity: 0; }
}
</style>
