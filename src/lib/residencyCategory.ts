/** Department of a residency record. The name is a label, not a category. */

export type ResidencyDepartment = 'PW' | 'FOLK';

function present(value: unknown): boolean {
  return value != null && String(value).trim() !== '';
}

export function normalizeResidencyCategory(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '');
}

/** True only when the value itself is the Prabhupada World category. */
export function isPrabhupadaWorldCategory(value: unknown): boolean {
  const token = normalizeResidencyCategory(value);
  return token === 'PW' || token === 'PRABHUPADAWORLD';
}

/** Explicit category on the record. `segment` is the stored department when `category` is absent. */
export function residencyCategoryValue(record: { category?: unknown; segment?: unknown } | null | undefined): unknown {
  if (present(record?.category)) return record?.category;
  if (present(record?.segment)) return record?.segment;
  return undefined;
}

export function isPrabhupadaWorldResidency(record: { category?: unknown; segment?: unknown } | null | undefined): boolean {
  return isPrabhupadaWorldCategory(residencyCategoryValue(record));
}

export function residencyMatchesDepartment(
  record: { category?: unknown; segment?: unknown } | null | undefined,
  department?: ResidencyDepartment | null,
): boolean {
  const isPw = isPrabhupadaWorldResidency(record);
  return department === 'PW' ? isPw : !isPw;
}

export function isActiveResidency(record: { isActive?: unknown } | null | undefined): boolean {
  return record?.isActive !== false && record?.isActive !== 'false';
}

export function isActiveFolkResidency(record: { category?: unknown; segment?: unknown; isActive?: unknown } | null | undefined): boolean {
  return isActiveResidency(record) && !isPrabhupadaWorldResidency(record);
}
