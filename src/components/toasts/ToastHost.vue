<template>
  <Teleport v-if="portal" :to="portal">
    <div class="app-toast-host">
      <TransitionGroup v-for="position in TOAST_POSITIONS" :key="position" name="toast-stack" tag="div"
        class="app-toast-stack" :class="`app-toast-stack--${position}`">
        <div v-for="toast in at(position)" :key="toast.id" class="app-toast-entry">
          <ToastCard :toast="toast" @dismiss="toastController.dismiss(toast.id)"
            @pause="toastController.pause(toast.id, $event)" @resume="toastController.resume(toast.id, $event)"
            @action="toastController.act(toast.id, $event)" />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import ToastCard from './ToastCard.vue';
import { TOAST_POSITIONS } from '../../services/toastController.js';
import { toastItems, toastController } from '../../services/toasts.js';

const portal = shallowRef(null);
const at = position => toastItems.value.filter(item => item.config.position === position);
let observer;

// A body-only portal falls outside QDialog's focus trap and aria-modal tree.
// Move one stable portal into the foremost open dialog, so toast actions are
// reachable by keyboard and screen readers from Receive and other sheets too.
function syncPortal() {
  if (!portal.value) return;
  const dialogs = [...document.querySelectorAll('.q-dialog[aria-modal="true"] > .q-dialog__inner')];
  const target = dialogs.at(-1) || document.body;
  if (portal.value.parentNode !== target) target.appendChild(portal.value);
}
function visibilityChanged() {
  if (document.hidden) toastController.pauseAll('hidden');
  else toastController.resumeAll('hidden');
}
onMounted(() => {
  portal.value = document.createElement('div');
  portal.value.className = 'app-toast-portal';
  syncPortal();
  observer = new MutationObserver(syncPortal);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('visibilitychange', visibilityChanged);
  portal.value?.remove();
});
</script>

<style>
.app-toast-portal { position: fixed !important; inset: 0 !important; z-index: 9500 !important; width: 100% !important; max-width: none !important; height: 100% !important; max-height: none !important; pointer-events: none !important; overflow: visible !important; box-shadow: none !important; background: transparent !important; }
.app-toast-host { position: absolute; inset: 0; pointer-events: none; }
.app-toast-stack { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 16px; max-height: calc(100% - var(--safe-top, 0px) - var(--safe-bottom, 0px)); overflow-y: auto; overflow-x: clip; scrollbar-width: none; pointer-events: none; }
.app-toast-stack:empty { display: none; }
.app-toast-entry { flex-shrink: 0; max-width: 100%; }
.app-toast-stack--bottom, .app-toast-stack--bottom-left, .app-toast-stack--bottom-right { bottom: var(--safe-bottom, env(safe-area-inset-bottom, 0px)); }
.app-toast-stack--top, .app-toast-stack--top-left, .app-toast-stack--top-right { top: var(--safe-top, env(safe-area-inset-top, 0px)); }
.app-toast-stack--left, .app-toast-stack--center, .app-toast-stack--right { top: 50%; transform: translateY(-50%); }
.app-toast-stack--left, .app-toast-stack--top-left, .app-toast-stack--bottom-left { align-items: flex-start; }
.app-toast-stack--right, .app-toast-stack--top-right, .app-toast-stack--bottom-right { align-items: flex-end; }
.toast-stack-enter-active, .toast-stack-leave-active { transition: opacity 140ms ease; }
.toast-stack-enter-from, .toast-stack-leave-to { opacity: 0; }
.toast-stack-move { transition: transform 160ms ease; }
@media (prefers-reduced-motion: reduce) { .toast-stack-enter-active, .toast-stack-leave-active, .toast-stack-move { transition: none; } }
</style>
