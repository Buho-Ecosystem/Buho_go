/**
 * User-Friendly Error Messages
 *
 * Payment error pipeline. Two contracts:
 *
 *   buildPaymentError(error, ctx, $t)
 *     Full error descriptor used by the payment error dialog. Returns
 *       { title, reason, technical }
 *     where `reason` is the upstream prose when it passes a safety
 *     filter (LUD-06 `reason`, NWC `error.message`, LNbits `detail`,
 *     etc.), or a curated generic when the raw text is unsafe (stack
 *     traces, TypeError, gRPC service paths, hex blobs).
 *
 *   getUserFriendlyError / getUserFriendlyErrorMessage
 *     Backwards-compatible wrappers used by existing toast call sites.
 *     Same passthrough behaviour, shape kept for caller convenience.
 *
 * Design rule: the LUD-06 `reason` field is the protocol-blessed
 * user-facing string from the server. We pass it through verbatim
 * unless it looks like a JS stack trace, gRPC path, or hex blob.
 */

const REASON_MAX_LENGTH = 280;

/**
 * Build a structured payment-error descriptor.
 *
 * The `reasonSource` discriminates how `reason` was produced so the UI
 * can decide whether to attribute the text to a third party:
 *
 *   'upstream' — server prose passed the safety filter and is rendered
 *                verbatim. The dialog shows this in a quoted block with
 *                an attribution label (see `reasonAttribution`).
 *   'curated'  — we synthesised the text (insufficient-funds breakdown,
 *                tech-jargon translation). BuhoGO is speaking.
 *   'fallback' — generic "Please try again." when the raw is unsafe.
 *                BuhoGO is speaking.
 *
 * @param {Error|string} error
 * @param {object} ctx
 * @param {string} [ctx.context]    'payment' | 'withdraw' | 'transfer' |
 *                                  'receive' | 'connect' | 'kiosk' |
 *                                  'claim' | 'general'
 * @param {string} [ctx.walletType] 'spark' | 'lnbits' | 'nwc' | etc.
 * @param {string} [ctx.route]      Free-form route label,
 *                                  e.g. 'LNURL-pay → invoice fetch'
 * @param {number} [ctx.amountSats]
 * @param {Function} [$t]           Translation function ($t bound).
 * @returns {{
 *   title: string,
 *   reason: string,
 *   reasonSource: 'upstream'|'curated'|'fallback',
 *   reasonAttribution: string|null,
 *   technical: {
 *     raw: string, walletType: string|null, route: string|null,
 *     timestamp: string, amountSats: number|null
 *   }
 * }}
 */
export function buildPaymentError(error, ctx = {}, $t = null) {
  const t = $t || ((s) => s);
  const raw = extractRaw(error);
  const context = ctx.context || 'general';

  const title = titleForContext(context, t);

  let reason;
  let reasonSource;
  const breakdown = expandInsufficientFunds(raw, ctx.amountSats, t);
  const translated = translateTechJargon(raw, t);
  if (breakdown) {
    reason = breakdown;
    reasonSource = 'curated';
  } else if (translated) {
    reason = translated;
    reasonSource = 'curated';
  } else if (isUserSafeMessage(raw)) {
    reason = truncate(raw.trim(), REASON_MAX_LENGTH);
    reasonSource = 'upstream';
  } else {
    reason = t('Please try again.');
    reasonSource = 'fallback';
  }

  // Attribution is only meaningful when BuhoGO is forwarding third-party
  // text. Curated and fallback reasons are written by us and need no
  // label — adding one would falsely suggest the recipient said it.
  const reasonAttribution = reasonSource === 'upstream'
    ? attributionForContext(context, t)
    : null;

  return {
    title,
    reason,
    reasonSource,
    reasonAttribution,
    technical: {
      raw,
      walletType: ctx.walletType || null,
      route: ctx.route || null,
      timestamp: new Date().toISOString(),
      amountSats: typeof ctx.amountSats === 'number' ? ctx.amountSats : null,
    },
  };
}

/**
 * Backwards-compatible wrapper returning { title, description }.
 * `description` is the same upstream-passthrough string used by the
 * payment error dialog, so toast call sites that surface
 * caption: description now show the real reason too.
 */
export function getUserFriendlyError(error, context = 'general', $t = null) {
  const e = buildPaymentError(error, { context }, $t);
  return { title: e.title, description: e.reason };
}

/**
 * Backwards-compatible wrapper returning just the title.
 */
export function getUserFriendlyErrorMessage(error, context = 'general', $t = null) {
  return buildPaymentError(error, { context }, $t).title;
}

// ─── Internals ──────────────────────────────────────────────────────────

function extractRaw(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.toString() || '';
}

function titleForContext(context, t) {
  switch (context) {
    case 'payment':  return t('Payment failed');
    case 'withdraw': return t('Withdrawal failed');
    case 'transfer': return t('Transfer failed');
    case 'receive':  return t("Couldn't create invoice");
    case 'connect':  return t("Couldn't connect");
    case 'kiosk':    return t("Couldn't start payment");
    case 'claim':    return t("Couldn't complete");
    // LUD-04 login flow — user is signing in to a site, not configuring a wallet.
    case 'identity': return t("Couldn't sign you in");
    default:         return t('Something went wrong');
  }
}

/**
 * Attribution label shown above an upstream-sourced reason. The
 * wording depends on the user's role in the flow — in a withdraw the
 * user is the recipient, so labelling the server "recipient" would be
 * wrong. Every branch names the *other* side of the action.
 */
function attributionForContext(context, t) {
  switch (context) {
    case 'payment':  return t('Reported by the recipient');
    case 'withdraw': return t('Reported by the withdrawal service');
    case 'transfer': return t('Reported by the destination wallet');
    case 'kiosk':    return t('Reported by the payment service');
    default:         return t('Reported by the service');
  }
}

/**
 * When the upstream message follows the well-known "Insufficient funds
 * N / M" pattern (NWC INSUFFICIENT_BALANCE responses, Spark SDK,
 * various LNbits extensions) and we know how many sats the user just
 * tried to send, break the total out into send + fee so the user can
 * see why the required amount is larger than what they typed.
 *
 *   "Insufficient funds 109 / 50551"   with amountSats=50000
 *     → Not enough funds.
 *       Balance: 109 sats
 *       Required: 50,551 sats (50,000 + 551 fee)
 *
 * Returns null when the pattern doesn't match, when amountSats is
 * unknown, or when the numbers don't fit a sane balance/required/fee
 * shape. Falls back through the normal passthrough path in that case
 * so the original prose is never lost — only enhanced.
 */
function expandInsufficientFunds(rawMsg, amountSats, t) {
  if (!rawMsg) return null;
  if (typeof amountSats !== 'number' || !Number.isFinite(amountSats) || amountSats <= 0) return null;
  if (!/insufficient/i.test(rawMsg)) return null;

  const m = rawMsg.match(/(\d{1,15})\s*\/\s*(\d{1,15})/);
  if (!m) return null;

  const balance = Number(m[1]);
  const required = Number(m[2]);
  if (!Number.isFinite(balance) || !Number.isFinite(required)) return null;
  // Sanity: required must cover the attempted send (server fee can be 0).
  const fee = required - amountSats;
  if (fee < 0) return null;
  // Sanity: balance shouldn't exceed required, otherwise the pattern
  // probably isn't balance/required at all (e.g. some other ratio).
  if (balance >= required) return null;

  const fmt = new Intl.NumberFormat('en-US').format;
  const lines = [
    `${t('Not enough funds.')}`,
    `${t('Balance')}: ${fmt(balance)} ${t('sats')}`,
  ];
  if (fee > 0) {
    lines.push(`${t('Required')}: ${fmt(required)} ${t('sats')} (${fmt(amountSats)} + ${fmt(fee)} ${t('fee')})`);
  } else {
    lines.push(`${t('Required')}: ${fmt(required)} ${t('sats')}`);
  }
  return lines.join('\n');
}

/**
 * Replace technical-only failures (SDK version drift, raw fetch error)
 * with a curated message. Returns null when the raw text is not a
 * known tech-only failure, leaving it to the passthrough/fallback.
 */
function translateTechJargon(msg, t) {
  if (!msg) return null;
  const lower = msg.toLowerCase();

  // gRPC UNIMPLEMENTED / "deprecated endpoint" / service-path leaks
  // mean the wallet binary is too old to talk to the current backend.
  if (lower.includes('unimplemented')
      || lower.includes('deprecated')
      || lower.includes('clienterror')
      || /\/[a-z.]+\.[a-z]+service\//i.test(msg)) {
    return t('The app is out of date. Please update and try again.');
  }

  // Pure network failure with no upstream prose attached.
  if (lower === 'failed to fetch'
      || lower === 'network request failed'
      || lower === 'load failed') {
    return t("Couldn't reach the network. Please check your internet and try again.");
  }

  return null;
}

/**
 * True when `msg` looks like prose we can show to a user verbatim.
 * Filters out JS errors, stack traces, hex hashes, gRPC paths.
 */
function isUserSafeMessage(msg) {
  if (!msg) return false;
  const trimmed = msg.trim();
  if (trimmed.length < 3 || trimmed.length > 600) return false;
  // Common JS error prefixes.
  if (/^(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError):/i.test(trimmed)) return false;
  // Stack-trace frames.
  if (/\n\s*at\s+\S+\s*\(/.test(trimmed)) return false;
  // "is not a function" / "is not defined" style runtime errors.
  if (/\bis not (a function|defined|iterable)\b/i.test(trimmed)) return false;
  // Long hex blobs (txids, payment hashes leaking into prose).
  if (/[0-9a-f]{40,}/i.test(trimmed)) return false;
  // gRPC service paths.
  if (/\/[a-z.]+\.[a-z]+service\//i.test(trimmed)) return false;
  return true;
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export default { buildPaymentError, getUserFriendlyError, getUserFriendlyErrorMessage };
