import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'BVSL saves their own 1:1 booking link',
  authenticated: true,
  inputSchema: z.object({ link: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    await Users.update({ id: context.user!.id, record: { oneToOneLink: input.link } });
    return { success: true };
  },
});
