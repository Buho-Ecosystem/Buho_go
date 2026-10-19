<!--
  StoreBadges: where to get BuhoGO for Android, as the stores' own badges
  (Google Play, Zapstore). One place for the badges and their links; the
  links are the ones the app's update check uses.
-->
<template>
  <div class="store-badge-row">
    <a class="store-badge-btn" :href="urls.play" target="_blank" rel="noopener noreferrer" data-audit="store-play">
      <span class="store-badge-playstore">
        <img src="/Playstore/google-play-icon.svg" alt="" width="24" height="24" />
        <span class="store-badge-text">
          <span class="store-badge-eyebrow">GET IT ON</span>
          <span class="store-badge-title">Google Play</span>
        </span>
      </span>
    </a>
    <a class="store-badge-btn" :href="urls.zapstore" target="_blank" rel="noopener noreferrer" data-audit="store-zapstore">
      <img src="/ZapStore/get-it-on-zapstore.png" alt="Get it on Zapstore" class="store-badge-img" />
    </a>
  </div>
</template>

<script>
import { DEFAULT_UPDATE_URLS } from '../services/appUpdate.js';

export default {
  name: 'StoreBadges',
  data() {
    return { urls: DEFAULT_UPDATE_URLS };
  },
};
</script>

<style scoped>
/* The official badges are boxes by design. */
.store-badge-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.store-badge-btn {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.1s ease;
}

.store-badge-btn:active {
  transform: scale(0.97);
}

.store-badge-btn:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 3px;
  border-radius: 10px;
}

.store-badge-img {
  height: 44px;
  width: auto;
  display: block;
}

.store-badge-playstore {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 44px;
  padding: 0 14px;
  border-radius: 10px;
  background: #000;
  border: 1.5px solid #A6A6A6;
  box-sizing: border-box;
}

.store-badge-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.store-badge-eyebrow {
  font-family: 'Manrope', sans-serif;
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #A6A6A6;
}

.store-badge-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14.5px;
  font-weight: 700;
  color: #fff;
  margin-top: 2px;
}
</style>
