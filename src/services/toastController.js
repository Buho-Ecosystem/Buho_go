// Toast state is independent of Vue and the payment that produced a notice.
// A dismissal only removes presentation; it never cancels the caller's work.
export const TOAST_POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const TYPES = {
  positive: { icon: 'check_circle', color: 'positive' },
  negative: { icon: 'warning', color: 'negative' },
  warning: { icon: 'priority_high', color: 'warning', textColor: 'dark' },
  info: { icon: 'info', color: 'info' },
  ongoing: { group: false, timeout: 0, spinner: true, color: 'grey-8' },
};

export function createToastController({
  onChange = () => {}, now = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, defaults: initialDefaults = {},
} = {}) {
  const records = new Map();
  const groups = new Map();
  const globalPauses = new Set();
  const types = { ...TYPES };
  let defaults = { timeout: 2500, position: 'bottom', progress: true, textColor: 'white', ...initialDefaults };
  let sequence = 0;

  const publish = () => onChange([...records.values()].map(r => ({
    id: r.id, config: r.config, count: r.count, revision: r.revision,
    duration: r.duration, remaining: r.remaining, running: r.timer !== null,
  })));

  function normalize(input) {
    const source = typeof input === 'string' ? { message: input } : { ...input };
    const base = source.ignoreDefaults ? {} : defaults;
    const type = types[source.type || base.type] || {};
    const config = { ...base, ...type, ...source };
    config.actions = [...(source.actions || []), ...(base.actions || []), ...(type.actions || [])];
    // A closeBtn is rendered as the accessible dismiss control, not an action.
    config.position = TOAST_POSITIONS.includes(config.position) ? config.position : 'bottom';
    const timeout = Number(config.timeout ?? 5000);
    config.timeout = Number.isFinite(timeout) && timeout >= 0 ? timeout : 5000;
    config.multiLine ??= config.actions.length > 1;
    const group = config.group === false ? null : JSON.stringify([
      config.group === undefined || config.group === true
        ? [config.message, config.caption, config.multiLine, config.actions.map(a => [a.label, a.icon])]
        : config.group,
      config.position,
    ]);
    return { source, config, group };
  }

  function stop(r) {
    if (r.timer !== null) {
      clearTimer(r.timer);
      r.timer = null;
      r.remaining = Math.max(0, r.deadline - now());
    }
  }

  function arm(r) {
    if (!r.duration || r.pauses.size || globalPauses.size || r.timer !== null) return;
    r.deadline = now() + r.remaining;
    r.timer = setTimer(() => dismiss(r.id), r.remaining);
  }

  function reset(r) {
    stop(r);
    // Preserve Quasar 2.33's timeout + 1000 ms entrance allowance.
    r.duration = r.config.timeout > 0 ? r.config.timeout + 1000 : 0;
    r.remaining = r.duration;
    r.revision++;
    arm(r);
  }

  function dismiss(id) {
    const r = records.get(id);
    if (!r) return;
    stop(r);
    records.delete(id);
    if (r.group !== null) groups.delete(r.group);
    publish();
    try { r.config.onDismiss?.(); } catch (error) { console.error('Toast dismissal callback failed:', error); }
  }

  function notify(input) {
    if (input == null) return () => {};
    const normalized = normalize(input);
    let r = records.get(groups.get(normalized.group));
    if (r) {
      Object.assign(r, normalized);
      r.count++;
    } else {
      r = { ...normalized, id: ++sequence, count: 1, revision: 0, timer: null, pauses: new Set() };
      records.set(r.id, r);
      if (r.group !== null) groups.set(r.group, r.id);
    }
    reset(r);
    publish();
    const id = r.id;
    return changes => {
      if (changes === undefined) return dismiss(id);
      const current = records.get(id);
      if (!current) return;
      if (current.group !== null) {
        console.warn('Grouped notifications cannot be updated');
        return;
      }
      Object.assign(current, normalize({ ...current.source, ...changes, group: false, position: current.config.position }));
      reset(current);
      publish();
    };
  }

  function pause(id, reason) {
    const r = records.get(id);
    if (!r || r.pauses.has(reason)) return;
    stop(r);
    r.pauses.add(reason);
    publish();
  }
  function resume(id, reason) {
    const r = records.get(id);
    if (!r || !r.pauses.delete(reason)) return;
    arm(r);
    publish();
  }
  function pauseAll(reason) {
    if (globalPauses.has(reason)) return;
    globalPauses.add(reason);
    records.forEach(stop);
    publish();
  }
  function resumeAll(reason) {
    if (!globalPauses.delete(reason)) return;
    records.forEach(arm);
    publish();
  }
  function act(id, index) {
    const r = records.get(id);
    const action = r?.config.actions[index];
    if (!action || action.disable || action.disabled || action.loading) return;
    try { action.handler?.(); } finally { if (!action.noDismiss) dismiss(id); }
  }
  notify.setDefaults = options => { defaults = { ...defaults, ...options }; };
  notify.registerType = (name, options) => { types[name] = { ...options }; };
  return { notify, dismiss, pause, resume, pauseAll, resumeAll, act };
}
