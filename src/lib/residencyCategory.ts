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

/** A residency record may carry a name and other fields. Only category and segment classify it. */
type ResidencyRecord = {
  category?: unknown;
  segment?: unknown;
  isActive?: unknown;
  [key: string]: unknown;
} | null | undefined;

/** Explicit category on the record. `segment` is the stored department when `category` is absent. */
export function residencyCategoryValue(record: ResidencyRecord): unknown {
  if (present(record?.category)) return record?.category;
  if (present(record?.segment)) return record?.segment;
  return undefined;
}

export function isPrabhupadaWorldResidency(record: ResidencyRecord): boolean {
  return isPrabhupadaWorldCategory(residencyCategoryValue(record));
}

export function residencyMatchesDepartment(
  record: ResidencyRecord,
  department?: ResidencyDepartment | null,
): boolean {
  const isPw = isPrabhupadaWorldResidency(record);
  return department === 'PW' ? isPw : !isPw;
}

export function isActiveResidency(record: ResidencyRecord): boolean {
  return record?.isActive !== false && record?.isActive !== 'false';
}

export function isActiveFolkResidency(record: ResidencyRecord): boolean {
  return isActiveResidency(record) && !isPrabhupadaWorldResidency(record);
}
