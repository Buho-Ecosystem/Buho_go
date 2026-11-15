/** Breez flattens LNURL HTTP failures into SDK error messages. Keep matching narrow. */
export function lightningAddressErrorKind(error) {
  const status = Number(error?.status ?? error?.statusCode);
  const message = String(error?.message || error || '');
  if (status === 429 || /\bstatus 429\b|\brate limit(?:ed| exceeded)?\b|too many requests/i.test(message)) return 'rate-limit';
  if (status === 409 || /\bstatus 409\b|username (?:is )?(?:taken|unavailable)|already (?:taken|registered)|name (?:is )?(?:taken|in use)/i.test(message)) return 'conflict';
  return 'unknown';
}
