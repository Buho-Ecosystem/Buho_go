import { boot } from 'quasar/wrappers';
import { Notify } from 'quasar';
import { installToasts } from '../services/toasts.js';

export default boot(({ app }) => {
  installToasts(app.config.globalProperties.$q, Notify);
});
