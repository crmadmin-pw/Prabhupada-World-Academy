/** The current FOLK residency flag does not describe dates before a status change. */
export function folkResidentStart(user: {
  residentSince?: unknown;
  residencyJoinDate?: unknown;
}): string | null {
  for (const value of [user.residentSince, user.residencyJoinDate]) {
    const date = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  return null;
}

export function wasFolkResidentOnDate(user: {
  residency?: unknown;
  residencyApproved?: unknown;
  residencyGuideVerified?: unknown;
  residentSince?: unknown;
  residencyJoinDate?: unknown;
}, date: string): boolean {
  const residency = Array.isArray(user.residency) ? user.residency[0] : user.residency;
  if (!(residency && (user.residencyApproved || user.residencyGuideVerified))) return false;
  const start = folkResidentStart(user);
  return !start || date >= start;
}

export function wasFolkScholarOnDate(user: {
  temporaryResidencyEnabled?: unknown;
  temporaryResidency?: unknown;
  scholarSince?: unknown;
}, date: string): boolean {
  const residency = Array.isArray(user.temporaryResidency) ? user.temporaryResidency[0] : user.temporaryResidency;
  if (!(user.temporaryResidencyEnabled && residency)) return false;
  const start = String(user.scholarSince || '').slice(0, 10);
  return !/^\d{4}-\d{2}-\d{2}$/.test(start) || date >= start;
}

/** null means an older entry did not record which form was submitted. */
export function residentTemplateMode(mode: unknown): boolean | null {
  const value = String(mode || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (value.includes('NON_RESIDENT') || value === 'NR' || value === 'NR_TEMPLATE') return false;
  if (value.includes('RESIDENT')) return true;
  return null;
}
