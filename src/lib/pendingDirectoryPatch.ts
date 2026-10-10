export type PendingDirectoryPatch = Record<string, string | number | boolean | null>;

/** A directory reload can still be the response from before this save.
 * Keep the confirmed fields on the row until a later response echoes them. */
export function mergePendingDirectoryPatches<T>(
  list: T[],
  pending: Map<string, PendingDirectoryPatch>,
  keysFor: (row: T) => string[],
): T[] {
  if (pending.size === 0) return list;
  return list.map(candidate => {
    const patch = keysFor(candidate)
      .map(key => pending.get(key))
      .find((value): value is PendingDirectoryPatch => !!value);
    if (!patch || directoryPatchEchoed(candidate, patch)) return candidate;
    return { ...candidate, ...patch };
  });
}

export function directoryPatchEchoed(candidate: unknown, patch: PendingDirectoryPatch): boolean {
  const row = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
  return Object.entries(patch).every(([key, expected]) => {
    const actual = row[key];
    if (typeof expected === 'boolean') return !!actual === expected;
    if (expected == null || expected === '') return actual == null || actual === '';
    return String(actual ?? '') === String(expected);
  });
}

export function bvRolePatch(input: {
  isAdmin: boolean;
  isSupervisor: boolean;
  isFacilitator: boolean;
  isSubFacilitator: boolean;
  primaryRole: string;
  parentId?: string | null;
  parentName?: string | null;
}): PendingDirectoryPatch {
  const patch: PendingDirectoryPatch = {
    isBvAdmin: input.isAdmin,
    isBvSupervisor: input.isSupervisor,
    isBvMentor: input.isSupervisor,
    isBvFacilitator: input.isFacilitator,
    isBvsl: input.isFacilitator,
    isBvSubFacilitator: input.isSubFacilitator,
    isBvMember: true,
  };
  const parentId = input.parentId || null;
  const parentName = input.parentName || null;
  if (input.primaryRole === 'SUPERVISOR') {
    patch.bvReportingAdminId = parentId;
    patch.bvReportingAdminName = parentName;
  } else if (input.primaryRole === 'FACILITATOR') {
    patch.bvReportingSupervisorId = parentId;
    patch.bvReportingSupervisorName = parentName;
  } else if (input.primaryRole === 'SUB_FACILITATOR' || input.primaryRole === 'MEMBER') {
    patch.bvReportingFacilitatorId = parentId;
    patch.bvReportingFacilitatorName = parentName;
  }
  return patch;
}

export type PendingMentor = { userId: string; fullName: string; email?: string; tagged: boolean };

/** The mentor dropdown is a separate cached list from the member row. */
export function mergePendingMentors<T extends { userId?: string }>(
  list: T[],
  pending: Map<string, PendingMentor>,
): T[] {
  if (pending.size === 0) return list;
  const next = list.slice();
  for (const mentor of pending.values()) {
    const index = next.findIndex(item => String(item.userId || '') === mentor.userId);
    if (mentor.tagged && index === -1) {
      next.push({ userId: mentor.userId, fullName: mentor.fullName, email: mentor.email || '' } as unknown as T);
    } else if (!mentor.tagged && index !== -1) {
      next.splice(index, 1);
    }
  }
  return next;
}
