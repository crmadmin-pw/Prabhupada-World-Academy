import { z } from 'zod';
import { createEndpoint, Guides } from '@/lib/backend-sdk';
import { enforceRateLimit } from '../utils/rateLimit';

const CHECKS_PER_EMAIL = 8;
const CHECK_WINDOW_MS = 60 * 60 * 1000;

export default createEndpoint({
  description: 'Check if an email belongs to an active guide',
  public: true,
  inputSchema: z.object({ email: z.string().email() }),
  outputSchema: z.object({ isGuide: z.boolean() }),
  execute: async ({ input }) => {
    const email = input.email.toLowerCase().trim();
    await enforceRateLimit(`guide-email:${email}`, CHECKS_PER_EMAIL, CHECK_WINDOW_MS);
    const guide = await Guides.findOne({
      filters: { email, isActive: true },
    });
    return { isGuide: !!guide };
  },
});
