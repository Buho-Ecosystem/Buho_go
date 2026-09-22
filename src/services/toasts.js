import { shallowRef } from 'vue';
import { createToastController } from './toastController.js';

export const toastItems = shallowRef([]);
export const toastController = createToastController({ onChange: items => { toastItems.value = items; } });

// Both public notification entry points use one controller. Keeping this
// adapter at boot also covers services, NFC and deep links outside Vue pages.
export function installToasts($q, Notify) {
  toastController.notify.setDefaults($q.config.notify || {});
  $q.notify = Notify.create = toastController.notify;
  Notify.setDefaults = toastController.notify.setDefaults;
  Notify.registerType = toastController.notify.registerType;
}
