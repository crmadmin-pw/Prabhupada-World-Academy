import { FolkResidencies, Services } from '@/lib/backend-sdk';
import { serverCacheGetOrFetch, serverCacheInvalidate } from '@/lib/serverCache';

const ACTIVE_SERVICES_CACHE_KEY = 'service_reference:active';
const REFERENCE_TTL_MS = 5 * 60 * 1000;
const SERVICE_FIELDS = [
  'id', 'serviceName', 'timeSlot', 'description', 'category', 'peopleNeeded',
  'serviceScope', 'residency', 'sortOrder', 'isActive',
];

export async function getCachedActiveServices(): Promise<any[]> {
  return serverCacheGetOrFetch(
    ACTIVE_SERVICES_CACHE_KEY,
    async () => {
      const result = await Services.findAll({
        filters: { isActive: true },
        fields: SERVICE_FIELDS,
        limit: 200,
      });
      return result.records;
    },
    REFERENCE_TTL_MS,
  );
}

export async function resolveCachedResidencyDbId(rawResidency?: string): Promise<string | undefined> {
  if (!rawResidency) return undefined;
  return serverCacheGetOrFetch(
    `service_reference:residency:${rawResidency}`,
    async () => {
      const [byCustomId, byDbId] = await Promise.all([
        FolkResidencies.findOne({ filters: { residencyId: rawResidency }, fields: ['id'] }),
        FolkResidencies.findOne({ id: rawResidency, fields: ['id'] }),
      ]);
      return byCustomId?.id || byDbId?.id;
    },
    REFERENCE_TTL_MS,
  );
}

export function invalidateServiceReferenceData(): void {
  serverCacheInvalidate('service_reference:');
}
