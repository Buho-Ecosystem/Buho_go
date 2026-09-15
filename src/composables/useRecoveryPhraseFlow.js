import { ref } from 'vue';

/** Shared phrase lifecycle. Callbacks keep wallet/identity storage outside the UI. */
export function useRecoveryPhraseFlow({ load, save, authorize, onVerified = () => {}, duration = 120 }) {
  const step = ref('prepare');
  const words = ref([]);
  const visible = ref(false);
  const busy = ref(false);
  const error = ref('');
  const remaining = ref(duration);
  let revision = 0;
  let timer;

  function stopTimer() { clearInterval(timer); timer = undefined; }
  function wipe() { words.value.fill(''); words.value = []; }
  function reset() {
    revision += 1;
    stopTimer();
    wipe();
    step.value = 'prepare';
    visible.value = false;
    busy.value = false;
    error.value = '';
  }

  async function start() {
    if (busy.value) return;
    const request = ++revision;
    busy.value = true;
    error.value = '';
    try {
      const allowed = await authorize();
      if (request !== revision) return;
      if (!allowed) { error.value = 'auth'; return; }
      const phrase = await load();
      if (request !== revision) return;
      const parsed = phrase.trim().split(/\s+/);
      if (![12, 24].includes(parsed.length)) throw new Error('Invalid phrase length');
      words.value = parsed;
      step.value = 'write';
      visible.value = false;
    } catch {
      if (request === revision) error.value = 'load';
    } finally {
      if (request === revision) busy.value = false;
    }
  }

  function hide() { stopTimer(); visible.value = false; }
  function reveal() {
    if (step.value !== 'write' || !words.value.length) return;
    visible.value = true;
    remaining.value = duration;
    stopTimer();
    // Use elapsed wall time so a throttled/backgrounded tab cannot extend exposure.
    const deadline = Date.now() + duration * 1000;
    timer = setInterval(() => {
      remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (!remaining.value) hide();
    }, 1000);
  }

  function check() {
    if (step.value !== 'write' || !visible.value || busy.value) return;
    hide();
    step.value = 'check';
  }
  function back() {
    if (busy.value) return;
    error.value = '';
    hide();
    if (step.value === 'check') step.value = 'write';
    else reset();
  }

  async function confirm() {
    if (step.value !== 'check' || busy.value) return;
    const request = revision;
    busy.value = true;
    error.value = '';
    try {
      await save();
      if (request !== revision) return;
      hide();
      wipe();
      step.value = 'done';
      onVerified();
    } catch {
      if (request === revision) error.value = 'save';
    } finally {
      if (request === revision) busy.value = false;
    }
  }

  return { step, words, visible, busy, error, remaining, reset, start, hide, reveal, check, back, confirm };
}
