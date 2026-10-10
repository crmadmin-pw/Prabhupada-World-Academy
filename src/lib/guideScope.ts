// ══════════════════════════════════════════════════════════════════════════════
// guideScope.ts — Backend-only helpers for center-based guide authorization.
//
// Core rule: any guide linked to a FOLK Residency (center) has full rights over
// ALL users in that center, not just their directly-assigned folk.
//
// IMPORTANT: Import this file only from backend endpoint files (src/api/**).
// Do NOT import it from frontend files — it uses the backend SDK.
// ══════════════════════════════════════════════════════════════════════════════

import { Guides, FolkResidencies, Users } from '@/lib/backend-sdk';

export interface GuideScope {
  /** The DB record ID (UUID) of this guide in the Guides table */
  guideId: string;
  /** All FOLK Residency IDs this guide is linked to via folkResidencies */
  residencyIds: string[];
  /** Legacy residency names accepted while old user rows are migrated */
  residencyNames?: string[];
  /** The full name of the guide to resolve name-based direct assignments */
  guideName?: string;
  isSuperAdminScope?: boolean;
}

const normalizeRefs = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap(v => String(v || '').split(',')).map(v => v.trim()).filter(Boolean);
};

/** Resolve legacy residency names and new document IDs to canonical IDs. */
function resolveResidencyIds(values: unknown, records: any[]): string[] {
  const refs = normalizeRefs(values);
  if (refs.length === 0) return [];
  const byRef = new Map<string, string>();
  for (const record of records as any[]) {
    for (const ref of [record.id, record.residencyId, record.residencyName]) {
      if (ref) byRef.set(String(ref).trim().toLowerCase(), String(record.id));
    }
  }
  return [...new Set(refs.map(ref => byRef.get(ref.toLowerCase()) || '').filter(Boolean))];
}

/**
 * Look up the active guide record by email and return their scope.
 * Returns null if no active guide record is found.
 */
export async function getGuideScope(email: string): Promise<GuideScope | null> {
  const emailLower = (email || '').toLowerCase();
  
  // These reads are independent. In particular, a Users-only guide should
  // not wait through the legacy Guides fallback before their profile loads.
  const [directGuide, linkedUser, residencies] = await Promise.all([
    Guides.findOne({ filters: { email }, fields: ['id', 'folkResidencies', 'fullName', 'email', 'abbreviation'] }),
    Users.findOne({ filters: { email }, fields: ['id', 'userId', 'role', 'fullName', 'email', 'folkResidencies', 'isBvSuperAdmin', 'isBvAdmin'] }),
    FolkResidencies.findAll({ fields: ['id', 'residencyId', 'residencyName', 'guides', 'guideIds'], limit: 500 }),
  ]);
  let guide = directGuide;

  if (!guide) {
    const { records: allGuides } = await Guides.findAll({
      fields: ['id', 'folkResidencies', 'fullName', 'email', 'abbreviation', 'isSuperAdminScope'], limit: 500,
    });
    guide = allGuides.find((g: any) => (g.email || '').toLowerCase() === emailLower);
  }

  if (!guide) {
    const user = linkedUser || (email !== emailLower
      ? await Users.findOne({ filters: { email: emailLower }, fields: ['id', 'userId', 'role', 'fullName', 'email', 'folkResidencies', 'isBvSuperAdmin', 'isBvAdmin'] })
      : null);
    const normalizedRole = String(user?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
    if (user && (
      ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN'].includes(normalizedRole) ||
      user.isBvSuperAdmin || user.isBvAdmin
    )) {
      guide = {
        id: user.userId || user.id,
        fullName: user.fullName || user.email || '',
        email: email,
        folkResidencies: user.folkResidencies || [],
        isSuperAdminScope: ['SUPER_GUIDE', 'SUPER_ADMIN'].includes(normalizedRole) || !!user.isBvSuperAdmin,
      };
    }
  }

  // Newer role assignments are persisted on Users as well as Guides. If a
  // legacy Guides row has no residency links, merge the authenticated user's
  // assignment so every scoped report uses the current database state.
  if (guide && (!guide.folkResidencies || (Array.isArray(guide.folkResidencies) && guide.folkResidencies.length === 0))) {
    if (linkedUser?.folkResidencies) guide = { ...guide, folkResidencies: linkedUser.folkResidencies };
  }

  if (!guide) return null;

  // One fresh projected read supplies aliases, assignments and display names.
  // This is permission data, so it is only deduplicated within the request.
  const residencyRecords = residencies.records;
  let residencyIds = resolveResidencyIds(guide.folkResidencies, residencyRecords);

  // A residency may also be the source of truth for assignments (especially
  // after a Super Guide edits the hostel table). Merge those links by guide
  // identity so older guide rows remain discoverable.
  const guideKeys = new Set([guide.id, guide.fullName, guide.email].filter(Boolean).map((value: any) => String(value).trim().toLowerCase()));
  if (guideKeys.size > 0) {
    for (const residency of residencyRecords as any[]) {
      const refs = [...normalizeRefs(residency.guideIds), ...normalizeRefs(residency.guides)];
      if (refs.some(ref => guideKeys.has(ref.toLowerCase()))) residencyIds.push(String(residency.id));
    }
    residencyIds = [...new Set(residencyIds)];
  }

  const residencyNames: string[] = [];
  if (residencyIds.length > 0) {
    const idSet = new Set(residencyIds.map(id => String(id).toLowerCase()));
    for (const residency of residencyRecords as any[]) {
      if (idSet.has(String(residency.id || '').toLowerCase()) && residency.residencyName) {
        residencyNames.push(String(residency.residencyName));
      }
    }
  }

  return { guideId: guide.id, residencyIds, residencyNames, guideName: guide.fullName, isSuperAdminScope: !!(guide as any).isSuperAdminScope };
}

/**
 * Given a list of residency IDs, return all guide IDs linked to those residencies.
 * Useful for expanding BV Mentor scope to all guides in the same center(s).
 */
export async function getGuideIdsForResidencies(residencyIds: string[]): Promise<string[]> {
  if (residencyIds.length === 0) return [];
  const { records: guides } = await Guides.findAll({
    filters: { isActive: true } as any,
    fields: ['id', 'folkResidencies'],
    limit: 200,
  });
  const matchingIds: string[] = [];
  for (const g of guides) {
    let gResIds: string[] = [];
    if (Array.isArray(g.folkResidencies)) {
      gResIds = g.folkResidencies;
    } else if (g.folkResidencies) {
      gResIds = (g.folkResidencies as string).split(',').map((s: string) => s.trim());
    }
    if (gResIds.some(rid => residencyIds.includes(rid))) {
      matchingIds.push(g.id);
    }
  }
  return matchingIds;
}

/**
 * Returns true if the given user is within a guide's scope:
 * - User's residency is one of the guide's linked centers (center-based access), OR
 * - User is directly assigned to this guide (direct assignment)
 *
 * Either condition grants full management rights.
 */
export function isUserInGuideScope(
  scope: GuideScope,
  userRecord: { residency?: string | string[] | null; guide?: string | string[] | null },
): boolean {
  if (!scope) return false;
  if ((scope as any).isSuperAdminScope) return true;
  const userResidencyId = Array.isArray(userRecord.residency)
    ? userRecord.residency[0]
    : userRecord.residency;
  const userGuideId = Array.isArray(userRecord.guide)
    ? userRecord.guide[0]
    : userRecord.guide;
  // Center-based: user's residency is one of the guide's centers
  if (userResidencyId) {
    const residencyKey = String(userResidencyId).trim().toLowerCase();
    if (scope.residencyIds.some(id => String(id).trim().toLowerCase() === residencyKey)) return true;
    if ((scope.residencyNames || []).some(name => String(name).trim().toLowerCase() === residencyKey)) return true;
  }
  // Direct assignment: user is directly under this guide (by ID or by Name)
  if (userGuideId) {
    const guideKey = String(userGuideId).trim().toLowerCase();
    const scopeGuideId = String(scope.guideId || '').trim().toLowerCase();
    const scopeGuideName = String(scope.guideName || '').trim().toLowerCase();
    if (guideKey && (guideKey === scopeGuideId || (!!scopeGuideName && guideKey === scopeGuideName))) return true;
  }
  return false;
}
