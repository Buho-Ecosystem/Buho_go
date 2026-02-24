<template>
  <transition name="backup-banner">
    <div
      v-if="visible"
      class="backup-banner"
      :class="$q.dark.isActive ? 'banner-dark' : 'banner-light'"
    >
      <div class="banner-content">
        <div class="banner-icon">
          <q-icon name="las la-shield-alt" size="20px" />
        </div>
        <div class="banner-text">
          <span class="banner-title">{{ $t('Back up your wallet') }}</span>
          <span class="banner-desc">{{ $t('Protect your funds by saving your recovery phrase.') }}</span>
        </div>
      </div>
      <div class="banner-actions">
        <q-btn
          flat
          dense
          no-caps
          class="banner-backup-btn"
          :class="$q.dark.isActive ? 'backup-btn-dark' : 'backup-btn-light'"
          @click="$emit('backup')"
        >
          {{ $t('Back up now') }}
        </q-btn>
        <q-btn
          flat
          round
          dense
          icon="las la-times"
          size="sm"
          class="banner-dismiss-btn"
          :class="$q.dark.isActive ? 'dismiss-dark' : 'dismiss-light'"
          @click="$emit('dismiss')"
        />
      </div>
    </div>
  </transition>
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
.backup-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  margin: 0 16px 12px;
}

.banner-dark {
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.2);
}

.banner-light {
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.2);
}

.banner-content {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.banner-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(251, 191, 36, 0.15);
  color: #F59E0B;
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.banner-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #F59E0B;
  line-height: 1.3;
}

.banner-desc {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 11px;
  line-height: 1.4;
  color: #D97706;
}

.banner-dark .banner-desc {
  color: rgba(251, 191, 36, 0.7);
}

.banner-light .banner-desc {
  color: #B45309;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.banner-backup-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 8px;
}

.backup-btn-dark {
  background: rgba(251, 191, 36, 0.2);
  color: #FBBF24;
}

.backup-btn-dark:hover {
  background: rgba(251, 191, 36, 0.3);
}

.backup-btn-light {
  background: rgba(251, 191, 36, 0.15);
  color: #D97706;
}

.backup-btn-light:hover {
  background: rgba(251, 191, 36, 0.25);
}

.dismiss-dark {
  color: rgba(251, 191, 36, 0.5);
}

.dismiss-light {
  color: rgba(180, 83, 9, 0.5);
}

/* Transition */
.backup-banner-enter-active,
.backup-banner-leave-active {
  transition: all 0.3s ease;
}

.backup-banner-enter-from,
.backup-banner-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
