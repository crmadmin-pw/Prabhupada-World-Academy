export type RoleNoticeParts = {
  assigned: string[];
  removed: string[];
};

/** Split "Assigned role: RGSF | Removed role: RGF" without dropping which change it was. */
export function parseRoleNotice(notice: string): RoleNoticeParts {
  const assigned: string[] = [];
  const removed: string[] = [];
  const pattern = /(assigned|removed)\s+(?:role|responsibility):\s*([^|]+)/gi;
  for (const match of notice.matchAll(pattern)) {
    const names = match[2].split(',').map(name => name.trim()).filter(Boolean);
    if (match[1].toLowerCase() === 'removed') removed.push(...names);
    else assigned.push(...names);
  }
  return { assigned, removed };
}
