/**
 * Formatting shared by the emergency exit surfaces. Numbers always come
 * from a quote or the chain; these helpers only shape them for a sentence.
 */
import { isSameDay } from '../utils/exitKit.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatSats(value) {
  return Math.round(Number(value || 0)).toLocaleString();
}

export function formatDay(timestamp, locale) {
  return new Date(timestamp).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "today", "yesterday", or a short date. */
export function relativeDay(timestamp, t, locale, now = Date.now()) {
  if (!timestamp) return '';
  if (isSameDay(timestamp, now)) return t('today');
  if (isSameDay(timestamp, now - DAY_MS)) return t('yesterday');
  return formatDay(timestamp, locale);
}

export function durationText(ms, t) {
  const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
  if (hours < 48) return t('{hours} hours', { hours });
  return t('{days} days', { days: Math.round(hours / 24) });
}

export function shortAddress(address) {
  const text = String(address || '');
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
}
