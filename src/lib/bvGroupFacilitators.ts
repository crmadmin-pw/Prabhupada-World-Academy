export type GroupFacilitator = {
  id: string;
  userId: string;
  name: string;
};

/** Flatten a stored id or name, including values saved as an array. */
export function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textList);
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

/** Keep array positions, including blanks, so leader, id, and name stay aligned. */
function slotList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item ?? '').trim());
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

/**
 * One facilitator is stored as parallel strings (`bvslLeader` is the document
 * id, `bvslId` is the public user id). Several facilitators are stored as
 * parallel arrays in that same order.
 */
export function readGroupFacilitators(group: {
  bvslLeader?: unknown;
  bvslId?: unknown;
  bvslName?: unknown;
} | null | undefined): GroupFacilitator[] {
  if (!group) return [];
  const leaders = slotList(group.bvslLeader);
  const ids = slotList(group.bvslId);
  const names = slotList(group.bvslName);
  const count = Math.max(leaders.length, ids.length, names.length);
  const facilitators: GroupFacilitator[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = leaders[index] || '';
    const userId = ids[index] || '';
    const name = names[index] || '';
    if (!id && !userId && !name) continue;
    facilitators.push({ id, userId, name });
  }
  return facilitators;
}

export function facilitatorIdentityKeys(facilitator: {
  id?: string;
  userId?: string;
  name?: string;
  email?: string;
}): string[] {
  return [facilitator.id, facilitator.userId, facilitator.email, facilitator.name]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

export function facilitatorWrite(facilitators: GroupFacilitator[]): {
  bvslLeader: string | string[];
  bvslId: string | string[];
  bvslName: string | string[];
} {
  if (facilitators.length === 0) return { bvslLeader: '', bvslId: '', bvslName: '' };
  if (facilitators.length === 1) {
    const one = facilitators[0];
    return {
      bvslLeader: one.id,
      bvslId: one.userId || one.id,
      bvslName: one.name,
    };
  }
  return {
    bvslLeader: facilitators.map(item => item.id),
    bvslId: facilitators.map(item => item.userId || item.id),
    bvslName: facilitators.map(item => item.name),
  };
}

export function groupHasFacilitator(
  group: { bvslLeader?: unknown; bvslId?: unknown; bvslName?: unknown },
  aliases: Set<string>,
): boolean {
  return readGroupFacilitators(group).some(item =>
    facilitatorIdentityKeys(item).some(key => aliases.has(key)),
  );
}

export function joinFacilitatorNames(names: Array<string | null | undefined>): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const text = String(name || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique.join(', ');
}
