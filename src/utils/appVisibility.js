/**
 * "Is the app in front of the user?" as a subscription.
 *
 * The WebView's `visibilitychange` alone is not reliable on every Android
 * build, so Capacitor's app state events are listened to as well (the same two
 * sources `boot/dm-inbox.js` combines for the chat lifecycle). In a browser
 * there is no Capacitor plugin and the DOM event covers it.
 *
 *   const stop = onAppVisibility((visible) => { ... })
 *   stop()
 */
export function onAppVisibility(listener) {
  if (typeof document === 'undefined') return () => {};
  const cleanups = [];
  const onChange = () => listener(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', onChange);
  cleanups.push(() => document.removeEventListener('visibilitychange', onChange));

  let stopped = false;
  import('@capacitor/app')
    .then(({ App }) => Promise.all([
      App.addListener('appStateChange', ({ isActive }) => listener(isActive !== false)),
      App.addListener('pause', () => listener(false)),
      App.addListener('resume', () => listener(true)),
    ]))
    .then((handles) => {
      if (stopped) handles.forEach((handle) => handle?.remove?.());
      else cleanups.push(() => handles.forEach((handle) => handle?.remove?.()));
    })
    .catch(() => { /* no plugin in a browser: the DOM event is enough */ });

  return () => {
    stopped = true;
    cleanups.forEach((cleanup) => cleanup());
  };
}
