/**
 * Theme transition — every coloured surface cross-fades to the new
 * theme at the same time, over ~280 ms. No overlays, no sweeps, no
 * clip-paths — just a blanket CSS transition that kicks in for the
 * duration of the swap and then gets out of the way.
 *
 * The `theme-transitioning` class on <html> scopes the transition
 * so it only applies during the toggle. We never leave that class
 * on — otherwise every hover / focus / state change across the
 * whole app would acquire a 280 ms colour fade and the UI would
 * feel sluggish. The selectors are listed in app.css.
 *
 * Honours prefers-reduced-motion (instant toggle). Guards against
 * rapid re-triggering so the scoping class stays consistent.
 */

import { Dark } from 'quasar';
import { persistTheme } from '../boot/theme';

const DURATION_MS = 280;

let running = false;

export function toggleThemeWithSweep($q) {
  if (running) return;

  const dark = $q?.dark || Dark;

  if (prefersReducedMotion()) {
    dark.toggle();
    persistTheme(dark.isActive);
    return;
  }

  running = true;

  const root = document.documentElement;
  root.classList.add('theme-transitioning');
  dark.toggle();
  // Persist immediately after flipping — the cross-fade is cosmetic and the
  // user's choice should survive reload even if the transition is interrupted.
  persistTheme(dark.isActive);

  setTimeout(() => {
    root.classList.remove('theme-transitioning');
    running = false;
  }, DURATION_MS);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
