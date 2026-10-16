/**
 * The Spark reachability snapshot as reactive state (#381). The long-outage
 * level depends on how recent the last check is, so it is re-read once a
 * minute as well as on every change.
 */
import { onBeforeUnmount, shallowRef } from 'vue';
import { sparkReachability } from '../utils/sparkReachability.js';

export function useSparkReachability() {
  const store = sparkReachability();
  const state = shallowRef(store.snapshot());
  const off = store.subscribe((snapshot) => { state.value = snapshot; });
  const timer = setInterval(() => { state.value = store.snapshot(); }, 60 * 1000);
  onBeforeUnmount(() => {
    off();
    clearInterval(timer);
  });
  return state;
}
