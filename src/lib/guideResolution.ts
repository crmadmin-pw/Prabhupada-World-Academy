import { Guides, Users } from '@/lib/backend-sdk';

export type ResolvedGuide = {
  id: string;
  userId?: string;
  fullName?: string;
  email?: string;
  segment?: 'PW' | 'FOLK';
  isPrabhupadaWorldMentor?: boolean;
};

function asGuide(record: any): ResolvedGuide | null {
  if (!record) return null;
  const id = String(record.id || record.userId || '');
  if (!id) return null;

  const isPw = record.segment === 'PW' || record.isPrabhupadaWorldUser === true || record.isPrabhupadaWorldMentor === true;
  return {
    id,
    userId: record.userId || record.guideId || undefined,
    fullName: record.fullName || record.name || undefined,
    email: record.email || undefined,
    segment: isPw ? 'PW' : record.segment === 'FOLK' ? 'FOLK' : undefined,
    isPrabhupadaWorldMentor: isPw,
  };
}

/** Resolve a guide/admin selected in the UI from Firestore, without identity-specific aliases. */
export async function resolveGuideReference(reference?: string): Promise<ResolvedGuide | null> {
  const value = String(reference || '').trim();
  if (!value) return null;
  const email = value.toLowerCase();

  const guide = await Guides.findOne({ id: value }) ||
    await Guides.findOne({ filters: { guideId: value } }) ||
    (value.includes('@') ? await Guides.findOne({ filters: { email } }) : null);
  if (guide) return asGuide(guide);

  const user = await Users.findOne({ id: value }) ||
    await Users.findOne({ filters: { userId: value } }) ||
    (value.includes('@') ? await Users.findOne({ filters: { email } }) : null);
  return asGuide(user);
}

export function getUserSegment(user: { segment?: unknown; isPrabhupadaWorldUser?: unknown; isFolkUser?: unknown } | null | undefined): 'PW' | 'FOLK' | null {
  const segment = String(user?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (segment === 'FOLK' || user?.isFolkUser === true) return 'FOLK';
  if (segment === 'PW' || segment === 'PRABHUPADAWORLD' || user?.isPrabhupadaWorldUser === true) return 'PW';
  return null;
}

export function isAdminRole(user: { role?: unknown; isBvAdmin?: unknown; isBvSuperAdmin?: unknown } | null | undefined): boolean {
  const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
  return user?.isBvAdmin === true || user?.isBvSuperAdmin === true || role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function isSuperAdminRole(user: { role?: unknown; isBvSuperAdmin?: unknown } | null | undefined): boolean {
  const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
  return user?.isBvSuperAdmin === true || role === 'SUPER_ADMIN';
}
