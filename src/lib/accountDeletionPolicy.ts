export const ACCOUNT_DELETE_CONFIRM_TEXT = 'DELETE';
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
export const ACCOUNT_DELETION_GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;
export const FRESH_LOGIN_MAX_AGE_MS = 5 * 60 * 1000;
export const PENDING_DELETION_STATUS = 'Pending Deletion';
export const ACCOUNT_DELETED_STATUS = 'Account Deleted';
export const ACCOUNT_DELETED_LOGIN_MESSAGE = 'Your account had been deleted. Kindly contact support@prabhupadaworld.com for further help.';

const CLOCK_SKEW_MS = 60_000;

export function isPendingDeletion(status: unknown): boolean {
  return String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_') === 'PENDING_DELETION';
}

export function isAccountDeleted(status: unknown): boolean {
  return String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_') === 'ACCOUNT_DELETED';
}

/** Sadhana, reminder, and "has not reported" views skip a closed Prabhupada World account. */
export function isExcusedFromReporting(status: unknown): boolean {
  return isAccountDeleted(status);
}

/**
 * Explicit Prabhupada World membership is retained after deletion.
 * Folk accounts, including legacy rows with no department, are not.
 */
export function isPrabhupadaWorldAccount(profile: {
  segment?: unknown;
  isFolkUser?: unknown;
  isPrabhupadaWorldUser?: unknown;
  role?: unknown;
} | null | undefined): boolean {
  const segment = String(profile?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (segment === 'FOLK' || profile?.isFolkUser === true) return false;
  if (segment === 'PW' || segment === 'PRABHUPADAWORLD') return true;
  const role = String(profile?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (role === 'GUIDE' || role === 'SUPER_GUIDE' || role === 'SUPERGUIDE') return false;
  return profile?.isPrabhupadaWorldUser === true;
}

/** Typed confirmation and a recent sign-in. A boolean confirm flag is never enough. */
export function deletionAuthorizationFailure(input: {
  confirmText: unknown;
  authTimeSeconds: number | null | undefined;
  nowMs: number;
}): { code: 'BAD_REQUEST' | 'UNAUTHORIZED'; message: string } | null {
  if (typeof input.confirmText !== 'string' || input.confirmText.trim() !== ACCOUNT_DELETE_CONFIRM_TEXT) {
    return { code: 'BAD_REQUEST', message: 'Type DELETE to confirm account deletion.' };
  }
  if (typeof input.authTimeSeconds !== 'number' || !Number.isFinite(input.authTimeSeconds)) {
    return { code: 'UNAUTHORIZED', message: 'Sign in again before deleting your account.' };
  }
  const ageMs = input.nowMs - input.authTimeSeconds * 1000;
  if (ageMs < -CLOCK_SKEW_MS || ageMs > FRESH_LOGIN_MAX_AGE_MS) {
    return { code: 'UNAUTHORIZED', message: 'Sign in again before deleting your account.' };
  }
  return null;
}

export function storageObjectPath(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 2000) return null;

  const accept = (path: string) => {
    let normalized = path.split('?')[0].replace(/^\/+/, '');
    try { normalized = decodeURIComponent(normalized); } catch { return null; }
    if (!normalized.startsWith('uploads/') || normalized.includes('..') || normalized.includes('\\')) return null;
    return normalized;
  };

  if (!text.includes('://')) return accept(text);
  if (text.startsWith('gs://')) {
    const slash = text.indexOf('/', 'gs://'.length);
    if (slash < 0) return null;
    return accept(text.slice(slash + 1));
  }

  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.hostname === 'firebasestorage.googleapis.com') {
    const marker = '/o/';
    const index = url.pathname.indexOf(marker);
    if (index < 0) return null;
    return accept(url.pathname.slice(index + marker.length));
  }
  if (url.hostname === 'storage.googleapis.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return accept(parts.slice(1).join('/'));
  }
  return null;
}

export function collectStoragePaths(value: unknown, paths: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    const path = storageObjectPath(value);
    if (path) paths.add(path);
    return paths;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStoragePaths(item, paths);
    return paths;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) collectStoragePaths(nested, paths);
  }
  return paths;
}
