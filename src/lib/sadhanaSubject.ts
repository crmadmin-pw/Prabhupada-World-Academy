import { Users } from '@/lib/backend-sdk';
import { HIERARCHY_IDENTITY_FIELDS } from './hierarchyUtils';
import { PW_SADHANA_PRIVACY_FIELDS } from './pwSadhanaPrivacy';

/** Legacy entries may be owned by an Auth UID rather than a Users document id.
 * Resolve the person before making any Sadhana privacy decision. */
export async function findSadhanaSubject(identity: string, fields: string[]): Promise<any | null> {
  if (!identity) return null;
  const selected = [...new Set([...fields, 'status', ...HIERARCHY_IDENTITY_FIELDS, ...PW_SADHANA_PRIVACY_FIELDS])];
  const byId = await Users.findOne({ id: identity, fields: selected });
  // Older role updates created partial Users/USER-* documents. Those are
  // not the registered profile and must not shadow its history or privacy flags.
  if (byId?.userId && byId.status && byId.id !== byId.userId) return byId;
  for (const field of HIERARCHY_IDENTITY_FIELDS.filter(field => field !== 'id')) {
    const found = await Users.findOne({ filters: { [field]: field === 'email' ? identity.toLowerCase() : identity }, fields: selected });
    if (found) return found;
  }
  return byId || null;
}
