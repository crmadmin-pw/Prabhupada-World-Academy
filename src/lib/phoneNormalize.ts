/** Normalize phone to digits-only (preserving leading +) for matching */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const prefix = trimmed.startsWith('+') ? '+' : '';
  return prefix + trimmed.replace(/[^\d]/g, '');
}
