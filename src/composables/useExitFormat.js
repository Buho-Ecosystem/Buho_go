/**
 * Formatting shared by the emergency exit surfaces. Numbers always come
 * from a quote or the chain; these helpers only shape them for a sentence,
 * in the person's locale.
 */
import { isSameDay } from '../utils/exitKit.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function formatSats(value, locale) {
  return Math.round(Number(value || 0)).toLocaleString(locale);
}

export function formatDay(timestamp, locale) {
  return new Date(timestamp).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTime(timestamp, locale) {
  return new Date(timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** "today", "yesterday", or a short date. */
export function relativeDay(timestamp, t, locale, now = Date.now()) {
  if (!timestamp) return '';
  if (isSameDay(timestamp, now)) return t('today');
  if (isSameDay(timestamp, now - DAY_MS)) return t('yesterday');
  return formatDay(timestamp, locale);
}

/** "1 hour", "7 hours", "1 day", "13 days". */
export function durationText(ms, t) {
  const hours = Math.max(1, Math.round(ms / HOUR_MS));
  if (hours < 48) return hours === 1 ? t('1 hour') : t('{hours} hours', { hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t('1 day') : t('{days} days', { days });
}

export function shortAddress(address) {
  const text = String(address || '');
  return text.length > 18 ? `${text.slice(0, 10)}\u2026${text.slice(-6)}` : text;
}
