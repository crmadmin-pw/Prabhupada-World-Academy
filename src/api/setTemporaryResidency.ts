import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Set or clear the temporary FOLK Residency for a non-resident user visiting FOLK',
  authenticated: true,
  inputSchema: z.object({
    enabled: z.boolean(),
    residencyId: z.string().nullable().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    await Users.update({
      id: context.user!.id,
      record: {
        temporaryResidencyEnabled: input.enabled,
        temporaryResidency: input.enabled && input.residencyId ? input.residencyId : undefined,
      },
    });
    return { success: true };
  },
});
