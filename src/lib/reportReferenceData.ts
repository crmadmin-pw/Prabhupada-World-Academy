import { FolkResidencies, Guides } from '@/lib/app-backend-sdk';
import { serverCacheGetOrFetch } from './serverCache';

/** Display labels only. Authorization/hierarchy lookups deliberately stay fresh. */
export async function getReportReferenceData() {
  const result = await serverCacheGetOrFetch('reportReference:labels:v4', async () => {
    const [residencies, guides] = await Promise.all([
      FolkResidencies.findAll({ fields: ['id', 'residencyId', 'residencyName', 'isActive', 'category', 'segment', 'legacyNames'], limit: 500 }),
      Guides.findAll({ fields: ['id', 'fullName', 'abbreviation', 'email', 'segment'], limit: 500 }),
    ]);
    return { residencies: residencies.records, guides: guides.records };
  }, 60_000);
  return structuredClone(result);
}
