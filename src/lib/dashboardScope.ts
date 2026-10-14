/** Identity and authorization only. Names, phones, labels (folkResidencyCustomId,
 * guideName, residencyName), notices, and login timestamps are omitted. */
const IDENTITY_FIELDS = ['userId', 'email'];

const AUTHORIZATION_FIELDS = [
  'segment', 'role', 'roles', 'status',
  'isBvAdmin', 'isBvSuperAdmin', 'isBvSupervisor', 'isBvMentor', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
  'isSadhanaMentor',
  'guideId', 'guide', 'selectedGuideId', 'selectedFolkResidency', 'folkResidencies', 'bvGroupId',
  'bvReportingAdminId', 'bvReportingSupervisorId', 'bvReportingFacilitatorId',
];

const FLAG_FIELDS = new Set([
  'isBvAdmin', 'isBvSuperAdmin', 'isBvSupervisor', 'isBvMentor', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
  'isSadhanaMentor',
]);

const TOKEN_FIELDS = new Set(['segment', 'role', 'roles', 'status']);

function fieldMode(field: string): 'id' | 'token' | 'email' | 'flag' {
  if (field === 'email') return 'email';
  if (FLAG_FIELDS.has(field)) return 'flag';
  if (TOKEN_FIELDS.has(field)) return 'token';
  return 'id';
}

/** Blank, null, and undefined are the same value. Nested records contribute
 * their assignment id, not a display name. Role and status tokens ignore case. */
function canonical(value: unknown, mode: 'id' | 'token' | 'email' | 'flag'): unknown {
  if (mode === 'flag') return value === true;
  if (Array.isArray(value)) {
    const items = value
      .map(item => canonical(item, mode))
      .filter(item => item != null)
      .map(item => typeof item === 'string' ? item : JSON.stringify(item))
      .sort();
    return items.length ? items : null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['id', 'userId', 'guideId', 'residencyId', 'uid', 'role', 'email', 'fullName']) {
      const picked = record[key];
      if (picked != null && picked !== '') return canonical(picked, mode);
    }
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (mode === 'email') return trimmed.toLowerCase();
  if (mode === 'token') return trimmed.replace(/[\s-]+/g, '_').toUpperCase();
  return trimmed;
}

export function dashboardScope(profile: any, identity?: string | null): string {
  return JSON.stringify([
    canonical(identity, 'id'),
    ...IDENTITY_FIELDS.map(field => canonical(profile?.[field], fieldMode(field))),
    ...AUTHORIZATION_FIELDS.map(field => canonical(profile?.[field], fieldMode(field))),
  ]);
}
