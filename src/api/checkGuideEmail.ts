import { z } from 'zod';
import { createEndpoint, Guides } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Check if an email belongs to an active guide',
  inputSchema: z.object({ email: z.string().email() }),
  outputSchema: z.object({ isGuide: z.boolean() }),
  execute: async ({ input }) => {
    const guide = await Guides.findOne({
      filters: { email: input.email.toLowerCase().trim(), isActive: true },
    });
    return { isGuide: !!guide };
  },
});
