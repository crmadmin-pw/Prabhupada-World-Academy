/**
 * Directory data has existed with both database labels ("Active") and API
 * values ("ACTIVE"). Keep client-side member visibility independent of that
 * presentation detail.
 */
export function isActiveDirectoryMember(status: unknown): boolean {
  return String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_') === 'ACTIVE';
}
