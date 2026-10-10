export type RunningTimeSlotGroup = {
  meetingTime?: string | null;
  preferredTimeSlot?: string | null;
  segment?: string | null;
  isActive?: boolean | null;
};

export type BvDepartment = 'PW' | 'FOLK';

export function normalizeBvDepartment(value: unknown): BvDepartment | undefined {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized === 'FOLK') return 'FOLK';
  if (normalized === 'PW' || normalized === 'PRABHUPADAWORLD') return 'PW';
  return undefined;
}

function slotKey(value: string): string {
  return value.toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
}

/** Minutes from midnight for a label that starts with a 12-hour clock. Unparsed labels sort last. */
function startMinutes(label: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(label.trim());
  if (!match) return 24 * 60 + 1;
  const hours = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return hours * 60 + Number(match[2]);
}

/**
 * Distinct meeting times of groups that are actually running in one department.
 * A group with no stored segment is treated as Prabhupada World, matching how
 * older groups are assigned. Inactive groups and blank schedules are omitted.
 */
export function runningTimeSlotsFromGroups(
  groups: readonly RunningTimeSlotGroup[],
  segment: BvDepartment,
): string[] {
  const slots = new Map<string, string>();
  for (const group of groups) {
    if (group.isActive === false) continue;
    const groupSegment = normalizeBvDepartment(group.segment) || 'PW';
    if (groupSegment !== segment) continue;
    const label = String(group.meetingTime || group.preferredTimeSlot || '').trim();
    if (!label) continue;
    const key = slotKey(label);
    if (!slots.has(key)) slots.set(key, label);
  }
  return [...slots.values()].sort((left, right) => {
    const byTime = startMinutes(left) - startMinutes(right);
    return byTime || left.localeCompare(right);
  });
}
