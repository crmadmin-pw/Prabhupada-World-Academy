import { z } from 'zod';
import { createEndpoint, Guides } from 'zite-integrations-backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';

const CACHE_KEY = 'ref:guides_v2';
const TTL = 60 * 60 * 1000; // 1 hour — guides change very rarely

// Prabhupada World mentor — always present; not stored in Guides table
const PW_MENTOR = {
  guideId: 'MENTOR-PW-HIRANYAVARNA',
  name: 'Hiranyavarna Das',
  abbr: 'HVD',
  email: 'hiranyavarna@prabhupadaworld.org',
  isPrabhupadaWorldMentor: true,
};

export default createEndpoint({
  description: 'Get all active guides for registration / forms (server-cached 1h)',
  inputSchema: z.object({}),
  outputSchema: z.object({
    guides: z.array(z.object({
      guideId: z.string(),
      name: z.string(),
      abbr: z.string(),
      email: z.string().optional(),
      isPrabhupadaWorldMentor: z.boolean().optional(),
    })),
  }),
  execute: async () => {
    const guides = await serverCacheGetOrFetch(CACHE_KEY, async () => {
      const { records } = await Guides.findAll({ filters: { isActive: true }, limit: 500 });
      const SYSTEM_GUIDE_IDS = ['GUIDE-000', 'GUIDE-SUPER-PWA-GUIDE', 'GUIDE-001', 'GUIDE-ADMIN-001'];
      const folkGuides = records
        .filter(g => !SYSTEM_GUIDE_IDS.includes(g.guideId))
        .map(g => ({
          guideId: g.id,
          name: g.fullName || '',
          abbr: g.abbreviation || (g.fullName || '').slice(0, 3).toUpperCase(),
          email: g.email || '',
          isPrabhupadaWorldMentor: false,
        }));
      // Inject Prabhupada World mentor at the beginning so the user sees it prominently
      return [PW_MENTOR, ...folkGuides];
    }, TTL);

    return { guides };
  },
});

