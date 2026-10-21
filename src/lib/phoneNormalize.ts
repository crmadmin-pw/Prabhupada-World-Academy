/** Normalize phone to digits-only (preserving leading +) for matching */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const prefix = trimmed.startsWith('+') ? '+' : '';
  return prefix + trimmed.replace(/[^\d]/g, '');
}

/** Calling code as entered on Create Your Account, e.g. `+61`. */
export function canonicalCountryCode(raw: string | null | undefined, fallback = '+91'): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
  return digits ? `+${digits}` : fallback;
}

/**
 * Split a stored phone into country code and national number.
 * Registration saves E.164 as digits only (`614…`, not `+614…`), and national
 * lengths differ by country. Matching a known calling code keeps Australia `61`
 * from being rewritten as India `91`. A bare 10-digit Indian mobile stays local.
 * When Create Your Account stored a calling code, that code is kept as entered.
 */
export function splitStoredPhone(
  raw: string | null | undefined,
  countryCodes: readonly string[],
  fallbackCountryCode = '+91',
  preferredCountryCode?: string | null,
): { cc: string; num: string } {
  const trimmed = String(raw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  const preferred = String(preferredCountryCode ?? '').replace(/\D/g, '').slice(0, 4);
  if (preferred) {
    const national = digits.startsWith(preferred) && digits.length - preferred.length >= 7
      ? digits.slice(preferred.length)
      : digits;
    return { cc: `+${preferred}`, num: national };
  }

  if (!digits) return { cc: fallbackCountryCode, num: '' };

  const international = trimmed.startsWith('+') || digits.length > 10;
  if (international) {
    const codes = countryCodes
      .map(code => (code.startsWith('+') ? code : `+${code.replace(/\D/g, '')}`))
      .filter(code => code.length > 1)
      .sort((a, b) => b.length - a.length);
    for (const code of codes) {
      const prefix = code.slice(1);
      if (!digits.startsWith(prefix)) continue;
      const national = digits.slice(prefix.length);
      if (national.length >= 7 && national.length <= 12) return { cc: code, num: national };
    }
  }

  // Australian mobiles are 04xxxxxxxx (10 digits) or 4xxxxxxxx (9 digits).
  // Neither shape is an Indian mobile, which is 10 digits starting with 6-9.
  if ((digits.length === 10 && digits.startsWith('04')) || (digits.length === 9 && /^4\d{8}$/.test(digits))) {
    return { cc: '+61', num: digits };
  }

  return { cc: fallbackCountryCode, num: digits.length > 10 ? digits.slice(-10) : digits };
}
