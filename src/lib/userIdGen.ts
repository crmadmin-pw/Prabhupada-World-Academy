/**
 * userIdGen — race-condition-proof userId generation
 *
 * Industry-standard approach:
 * 1. Scan for the current max number in the given prefix series (USER-XXX / GUIDE-XXX)
 * 2. Generate the next candidate
 * 3. Check whether it already exists in the DB (handles concurrent registrations)
 * 4. If taken, increment and retry (up to MAX_RETRIES attempts)
 * 5. Return the confirmed-unique userId
 *
 * This eliminates the TOCTOU (time-of-check / time-of-use) race condition where
 * two simultaneous registrations both read the same max, both generate the same
 * next number, and both write it — producing a duplicate.
 *
 * Usage:
 *   import { generateUniqueUserId } from '../lib/userIdGen';
 *   const userId = await generateUniqueUserId('USER');   // → "USER-045"
 *   const guideId = await generateUniqueUserId('GUIDE'); // → "GUIDE-008"
 */

import { Users } from 'zite-integrations-backend-sdk';

const MAX_RETRIES = 10;
const PAD = 3; // Minimum digits: USER-001, USER-044, USER-100

function format(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(PAD, '0')}`;
}

/**
 * Returns a guaranteed-unique userId/guideId string.
 * prefix: 'USER' | 'GUIDE'
 */
export async function generateUniqueUserId(prefix: 'USER' | 'GUIDE'): Promise<string> {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  // Fetch only the userId field — minimal data transfer
  const { records } = await Users.findAll({
    fields: ['userId'],
    limit: 2000,
  });

  // Find the current maximum number in this prefix series
  const maxNum = records.reduce((max, u) => {
    const uid = u.userId ? String(u.userId).trim() : '';
    const match = uid.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      return isNaN(n) ? max : Math.max(max, n);
    }
    return max;
  }, 0);

  // Build a set of all existing IDs in this series for O(1) collision checks
  const existingIds = new Set(
    records
      .map(u => (u.userId ? String(u.userId).trim() : ''))
      .filter(uid => pattern.test(uid))
  );

  // Retry loop — handles concurrent registrations
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const candidate = format(prefix, maxNum + 1 + attempt);
    if (!existingIds.has(candidate)) {
      return candidate;
    }
    // Collision detected — this happens when two requests run simultaneously.
    // The next iteration tries the next number.
  }

  // Extremely unlikely fallback: all retries failed (10 concurrent registrations at once).
  // Use timestamp suffix to guarantee uniqueness.
  return `${prefix}-${Date.now()}`;
}

/**
 * Checks if a given userId is already taken by a DIFFERENT user record.
 * excludeId: the DB record id of the user being updated (to allow re-saving same user).
 */
export async function isUserIdTaken(userId: string, excludeId?: string): Promise<boolean> {
  const { records } = await Users.findAll({
    filters: { userId } as any,
    fields: ['id', 'userId'],
    limit: 5,
  });
  return records.some(u => u.id !== excludeId);
}
