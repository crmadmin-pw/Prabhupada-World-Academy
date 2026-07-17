// ══════════════════════════════════════════════════════════════════════════════
// guideScope.ts — Backend-only helpers for center-based guide authorization.
//
// Core rule: any guide linked to a FOLK Residency (center) has full rights over
// ALL users in that center, not just their directly-assigned folk.
//
// IMPORTANT: Import this file only from backend endpoint files (src/api/**).
// Do NOT import it from frontend files — it uses the backend SDK.
// ══════════════════════════════════════════════════════════════════════════════

import { Guides, FolkResidencies } from 'zite-integrations-backend-sdk';

export interface GuideScope {
  /** The DB record ID (UUID) of this guide in the Guides table */
  guideId: string;
  /** All FOLK Residency IDs this guide is linked to via folkResidencies */
  residencyIds: string[];
}

/**
 * Look up the active guide record by email and return their scope.
 * Returns null if no active guide record is found.
 */
export async function getGuideScope(email: string): Promise<GuideScope | null> {
  const guide = await Guides.findOne({
    filters: { email, isActive: true },
    fields: ['id', 'folkResidencies'],
  });
  if (!guide) return null;
  const residencyIds: string[] = Array.isArray(guide.folkResidencies)
    ? (guide.folkResidencies as string[])
    : (guide.folkResidencies ? [guide.folkResidencies as string] : []);
  return { guideId: guide.id, residencyIds };
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
    const gResIds: string[] = Array.isArray(g.folkResidencies)
      ? (g.folkResidencies as string[])
      : (g.folkResidencies ? [g.folkResidencies as string] : []);
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
  const userResidencyId = Array.isArray(userRecord.residency)
    ? userRecord.residency[0]
    : userRecord.residency;
  const userGuideId = Array.isArray(userRecord.guide)
    ? userRecord.guide[0]
    : userRecord.guide;
  // Center-based: user's residency is one of the guide's centers
  if (userResidencyId && scope.residencyIds.includes(userResidencyId as string)) return true;
  // Direct assignment: user is directly under this guide
  if (userGuideId && userGuideId === scope.guideId) return true;
  return false;
}
