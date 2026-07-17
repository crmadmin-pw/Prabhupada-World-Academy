import { z } from 'zod';
import { createEndpoint, Guides, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Save the guide\'s external 1:1 booking link (e.g. Calendly)',
  authenticated: true,
  inputSchema: z.object({ link: z.string() }),
  outputSchema: z.object({ success: z.boolean(), link: z.string() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    if (!['Guide', 'Super Guide'].includes(role)) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides can save a 1:1 booking link' });
    }

    const guide = await Guides.findOne({
      filters: { email: context.user.email, isActive: true },
      fields: ['id'],
    });
    if (!guide) throw new ZiteError({ code: 'NOT_FOUND', message: 'Guide record not found' });

    await Guides.update({ id: guide.id, record: { oneToOneLink: input.link } });
    return { success: true, link: input.link };
  },
});
