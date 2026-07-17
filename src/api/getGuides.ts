import { z } from 'zod';
import { createEndpoint, Guides } from 'zite-integrations-backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';

const CACHE_KEY = 'ref:guides';
const TTL = 60 * 60 * 1000; // 1 hour — guides change very rarely

export default createEndpoint({
  description: 'Get all active guides for registration / forms (server-cached 1h)',
  inputSchema: z.object({}),
  outputSchema: z.object({
    guides: z.array(z.object({
      guideId: z.string(),
      name: z.string(),
      abbr: z.string(),
      email: z.string().optional(),
    })),
  }),
  execute: async () => {
    const guides = await serverCacheGetOrFetch(CACHE_KEY, async () => {
      const { records } = await Guides.findAll({ filters: { isActive: true }, limit: 500 });
      return records
        .filter(g => g.guideId !== 'GUIDE-000')
        .map(g => ({
          guideId: g.id,
          name: g.fullName || '',
          abbr: g.abbreviation || (g.fullName || '').slice(0, 3).toUpperCase(),
          email: g.email || '',
        }));
    }, TTL);

    return { guides };
  },
});
