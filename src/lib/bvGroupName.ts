import { AppError, BvGroups } from '@/lib/backend-sdk';

/** Compare group names without case or extra spacing. */
export function normalizeBvGroupName(name: string): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function bvGroupDepartment(value: unknown): 'PW' | 'FOLK' | null {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized === 'PW' || normalized === 'PRABHUPADAWORLD') return 'PW';
  if (normalized === 'FOLK') return 'FOLK';
  return null;
}

function departmentLabel(department: 'PW' | 'FOLK' | null): string {
  if (department === 'FOLK') return 'FOLK';
  if (department === 'PW') return 'Prabhupada World';
  return 'Bhakti Vriksha';
}

/**
 * A reading-group name may exist once in Prabhupada World and once in FOLK.
 * A group with no department still reserves that name in both.
 */
export async function assertUniqueBvGroupName(
  name: string,
  department: 'PW' | 'FOLK' | null,
  exceptGroupIds: string[] = [],
): Promise<void> {
  const normalized = normalizeBvGroupName(name);
  if (!normalized) {
    throw new AppError({ code: 'BAD_REQUEST', message: 'Please enter a group name' });
  }

  const except = new Set(exceptGroupIds.map(id => String(id || '').trim()).filter(Boolean));
  const { records } = await BvGroups.findAll({
    fields: ['id', 'groupId', 'groupName', 'segment'],
    limit: 1000,
  });
  const conflict = (records || []).find(group => {
    if (except.has(String(group.id || '')) || except.has(String(group.groupId || ''))) return false;
    if (normalizeBvGroupName(group.groupName) !== normalized) return false;
    const existing = bvGroupDepartment(group.segment);
    if (!department || !existing) return true;
    return existing === department;
  });
  if (!conflict) return;

  const displayName = String(name).trim().replace(/\s+/g, ' ');
  throw new AppError({
    code: 'CONFLICT',
    message: `A ${departmentLabel(department)} reading group named "${displayName}" already exists`,
  });
}
