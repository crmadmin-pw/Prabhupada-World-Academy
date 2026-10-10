import { joinGroupByToken } from '@/lib/endpoints-sdk';

export const BV_JOIN_TOKEN_STORAGE_KEY = 'pwa_bv_join_token';

export function rememberBvJoinToken(token: string, isPw = false): void {
  if (typeof window === 'undefined') return;
  const clean = token.trim();
  if (!clean) return;
  localStorage.setItem(BV_JOIN_TOKEN_STORAGE_KEY, clean);
  localStorage.setItem('auth_redirect_after_callback', `/join-group?token=${encodeURIComponent(clean)}`);
  if (isPw) localStorage.setItem('pwa_is_pw_flow', 'true');
}

export function readBvJoinToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(BV_JOIN_TOKEN_STORAGE_KEY)?.trim() || '';
}

export function clearBvJoinToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(BV_JOIN_TOKEN_STORAGE_KEY);
  const pending = localStorage.getItem('auth_redirect_after_callback') || '';
  if (pending.startsWith('/join-group') || pending.includes('/join/')) {
    localStorage.removeItem('auth_redirect_after_callback');
  }
}

/** Join the group stored from an invite link, once this person has an account. */
export async function acceptStoredGroupInvite(): Promise<'joined' | 'needs-registration' | 'none'> {
  const token = readBvJoinToken();
  if (!token) return 'none';
  const result = await joinGroupByToken({ token });
  if (result?.needsRegistration) return 'needs-registration';
  if (result?.success) {
    clearBvJoinToken();
    return 'joined';
  }
  return 'none';
}
