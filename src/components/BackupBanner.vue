<template>
  <Transition name="backup-banner">
    <div
      v-if="visible"
      class="backup-banner-wrapper"
    >
      <div class="backup-banner" :class="$q.dark.isActive ? 'banner-dark' : 'banner-light'">
        <div class="banner-shine"></div>

        <div class="banner-body">
          <div class="banner-left">
            <div class="logo-block">
              <img
                src="/Buho_logo__Sharp_grey.jpg"
                alt="Buho"
                class="logo-image"
              />
            </div>

            <div class="banner-text">
              <span class="banner-title" :class="$q.dark.isActive ? 'title-dark' : 'title-light'">
                {{ $t('Back up your wallet') }}
              </span>
              <span class="banner-desc" :class="$q.dark.isActive ? 'desc-dark' : 'desc-light'">
                {{ $t('Protect your funds by saving your recovery phrase.') }}
              </span>
            </div>
          </div>

          <div class="banner-right">
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="$emit('backup')"
            >
              <span>{{ $t('Backup') }}</span>
              <Icon icon="tabler:chevron-right" width="14" height="14" class="action-arrow" />
            </button>

            <button
              class="dismiss-btn"
              :class="$q.dark.isActive ? 'dismiss-dark' : 'dismiss-light'"
              @click="$emit('dismiss')"
              aria-label="Dismiss"
            >
              <Icon icon="tabler:x" width="14" height="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script>
export default {
  name: 'BackupBanner',
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['backup', 'dismiss']
}
</script>

<style scoped>
.backup-banner-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 8px;
}

.backup-banner {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}

.banner-dark {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
  border: 1px solid rgba(59, 130, 246, 0.15);
}

.banner-light {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 50%, #eff6ff 100%);
  border: 1px solid rgba(59, 130, 246, 0.2);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
}

/* Subtle shine sweep */
.banner-shine {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    120deg,
    transparent 0%,
    rgba(255, 255, 255, 0.04) 30%,
    rgba(255, 255, 255, 0.07) 50%,
    rgba(255, 255, 255, 0.04) 70%,
    transparent 100%
  );
  pointer-events: none;
}

.banner-light .banner-shine {
  background: linear-gradient(
    120deg,
    transparent 0%,
    rgba(255, 255, 255, 0.5) 30%,
    rgba(255, 255, 255, 0.7) 50%,
    rgba(255, 255, 255, 0.5) 70%,
    transparent 100%
  );
}

.banner-body {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px;
}

.banner-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

/* Logo */
.logo-block {
  flex-shrink: 0;
}

.logo-image {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  object-fit: cover;
}

/* Text */
.banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.banner-title {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.title-dark {
  color: #e0f2fe;
}

.title-light {
  color: #1e3a5f;
}

.banner-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  line-height: 1.4;
  letter-spacing: -0.01em;
}

.desc-dark {
  color: rgba(186, 230, 253, 0.6);
}

.desc-light {
  color: rgba(30, 64, 175, 0.55);
}

/* Right side */
.banner-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* Action button */
.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  border-radius: 10px;
  padding: 8px 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}

.action-btn-dark {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: #fff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.action-btn-dark:active {
  transform: scale(0.97);
}

.action-btn-light {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: #fff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
}

.action-btn-light:active {
  transform: scale(0.97);
}

/* Dismiss button */
.dismiss-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.dismiss-dark {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(186, 230, 253, 0.4);
}

.dismiss-light {
  background: rgba(59, 130, 246, 0.06);
  color: rgba(30, 64, 175, 0.35);
}

.dismiss-btn:active {
  transform: scale(0.92);
}

/* Transition */
.backup-banner-enter-active {
  animation: banner-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.backup-banner-leave-active {
  animation: banner-leave 0.35s cubic-bezier(0.4, 0, 1, 1) forwards;
}

@keyframes banner-enter {
  from {
    opacity: 0;
    transform: translateY(-16px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes banner-leave {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-10px) scale(0.98);
  }
}

/* Responsive */
@media (max-width: 480px) {
  .backup-banner-wrapper {
    padding: 6px;
  }

  .banner-body {
    padding: 12px;
  }

  .logo-image {
    width: 36px;
    height: 36px;
    border-radius: 8px;
  }

  .banner-title {
    font-size: 12px;
  }

  .banner-desc {
    font-size: 10px;
  }

  .action-btn {
    padding: 7px 12px;
    font-size: 11px;
  }
}
</style>
