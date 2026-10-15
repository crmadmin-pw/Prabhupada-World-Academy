import { z } from 'zod';
import { createEndpoint, Users } from '@/lib/backend-sdk';
import { isAccountDeleted } from '@/lib/accountDeletionPolicy';

export default createEndpoint({
  description: 'Update last login timestamp',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ context }) => {
    const user = await Users.findOne({
      id: context.user!.id,
      fields: ['id', 'userId', 'status'],
    });

    // Firestore set(..., { merge: true }) creates a document when it does not
    // exist. Do not let a login timestamp create a bare Users document for an
    // authenticated person who has not completed registration.
    if (!user?.userId || !user?.status || isAccountDeleted(user.status)) {
      return { success: false };
    }

    await Users.update({
      id: user.id,
      record: { lastLoginAt: new Date().toISOString() },
    });
    return { success: true };
  },
});
