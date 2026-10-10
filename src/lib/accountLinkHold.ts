export const ACCOUNT_LINK_HOLD_KEY = 'pwa_account_link_hold';

export type AccountLinkHoldAction = 'account_link_pending' | 'account_link_rejected';

export function readAccountLinkHold(): AccountLinkHoldAction | null {
  try {
    const value = sessionStorage.getItem(ACCOUNT_LINK_HOLD_KEY);
    if (value === 'account_link_pending' || value === 'account_link_rejected') return value;
  } catch {
    return null;
  }
  return null;
}

export function writeAccountLinkHold(action: AccountLinkHoldAction | null) {
  try {
    if (!action) sessionStorage.removeItem(ACCOUNT_LINK_HOLD_KEY);
    else sessionStorage.setItem(ACCOUNT_LINK_HOLD_KEY, action);
  } catch {
    // Private browsing can block session storage. The page still explains the hold.
  }
}
