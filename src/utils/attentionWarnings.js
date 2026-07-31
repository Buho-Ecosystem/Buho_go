// Shared persistence for dismissed Settings/Identity attention-strip
// warnings. Both the Settings tab (wallet-seed backup) and the Identity
// tab (identity backup) render their own SettingsAttentionStrip, but a
// dismissal must stick regardless of which tab wrote it, so both read
// and write the same localStorage key through this module rather than
// each keeping their own copy of the key string and (de)serialization.

const DISMISSED_WARNINGS_KEY = 'buhoGO_dismissed_attention_v1';

/**
 * @returns {string[]} warning ids the user has already dismissed
 */
export function loadDismissedWarnings() {
  try {
    const raw = localStorage.getItem(DISMISSED_WARNINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {string[]} ids
 */
export function saveDismissedWarnings(ids) {
  try {
    localStorage.setItem(DISMISSED_WARNINGS_KEY, JSON.stringify(ids));
  } catch {
    // Best-effort persistence; the in-memory dismissal still holds for
    // the rest of this session.
  }
}
