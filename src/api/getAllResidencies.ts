import { z } from 'zod';
import { createEndpoint, FolkResidencies } from 'zite-integrations-backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';

const CACHE_KEY = 'ref:residencies';
const TTL = 60 * 60 * 1000; // 1 hour — residencies change very rarely

export default createEndpoint({
  description: 'Get all active folk residencies (server-cached 1h)',
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({
    residencyId: z.string(),
    residencyName: z.string(),
  })),
  execute: async () => {
    return serverCacheGetOrFetch(CACHE_KEY, async () => {
      const { records } = await FolkResidencies.findAll({ limit: 200 });
      return records
        .filter(r => r.isActive !== false && r.isActive !== 'false')
        .map(r => ({
          residencyId: r.id,
          residencyName: r.residencyName || '',
        }));
    }, TTL);
  },
});
