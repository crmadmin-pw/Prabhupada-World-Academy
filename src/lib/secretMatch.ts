import { createHash, timingSafeEqual } from 'crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time check of a caller-supplied secret against configured values. */
export function matchesAnySecret(provided: unknown, expected: Array<string | undefined>): boolean {
  if (typeof provided !== 'string' || !provided) return false;
  const providedDigest = digest(provided);
  let matched = false;
  for (const secret of expected) {
    if (secret && timingSafeEqual(providedDigest, digest(secret))) matched = true;
  }
  return matched;
}
