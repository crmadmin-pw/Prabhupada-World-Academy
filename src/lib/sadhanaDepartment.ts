/** Resolve the subject's department rather than the dashboard viewer's role. */
export function isPwSadhanaUser(user: { segment?: unknown; isPrabhupadaWorldUser?: unknown } | null | undefined): boolean {
  const segment = String(user?.segment ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return segment ? ['PW', 'PRABHUPADAWORLD'].includes(segment) : user?.isPrabhupadaWorldUser === true;
}

export const PW_SADHANA_FORM_KEYS = new Set(['chanting', 'reading']);
