import { z } from 'zod';
import { createEndpoint, FolkResidencies } from '@/lib/backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';
import { isHierarchyAdmin, isHierarchySuperAdmin } from '../lib/hierarchyUtils';
import { getGuideScope } from '../lib/guideScope';

const CACHE_KEY = 'ref:residencies_v3';
const TTL = 5 * 1000; // 5 seconds — updates instantly when centers are added/deleted

export default createEndpoint({
  description: 'Get all active folk residencies (server-cached 1h)',
  public: true,
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.array(z.object({
    residencyId: z.string(),
    residencyName: z.string(),
  })),
  execute: async ({ input, context }: any) => {
    const list = await serverCacheGetOrFetch(CACHE_KEY, async () => {
      const { records } = await FolkResidencies.findAll({ limit: 200 });
      const activeResidencies = records
        .filter(r => r.isActive !== false && r.isActive !== 'false')
        .map(r => ({
          residencyId: r.id || r.residencyId,
          residencyName: r.residencyName || r.name || '',
        }));
      return activeResidencies;
    }, TTL);

    const scope = isHierarchyAdmin(context?.user) && !isHierarchySuperAdmin(context.user)
      ? await getGuideScope(context.user.email || '') : null;
    return list.filter((r: any) => {
      if (isHierarchyAdmin(context?.user) && !isHierarchySuperAdmin(context.user) && !scope?.residencyIds.includes(r.residencyId)) return false;
      return !r.residencyName.includes('Prabhupada World') && !r.residencyName.includes('PW');
    });
  },
});
