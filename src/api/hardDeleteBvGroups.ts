import { z } from 'zod';
import { createEndpoint, getFirestoreDb, AppError } from '@/lib/backend-sdk';
import { hasApiCapabilities } from '@/lib/apiAuthorization';
import { BV_DELETE_CONFIRMATION } from '@/lib/confirmBvGroupDeletion';
import { deleteBvGroupsWithAudit } from '@/lib/deleteBvGroupsWithAudit';

const inputSchema = z.object({
  groupNames: z.array(z.string().min(1)).max(100).optional(),
  groupIds: z.array(z.string().min(1)).max(100).optional(),
  deleteAll: z.boolean().optional(),
  confirmationPhrase: z.literal(BV_DELETE_CONFIRMATION),
}).refine(input => input.deleteAll === true || !!input.groupIds?.length || !!input.groupNames?.length, {
  message: 'Select groups to delete or explicitly request deleteAll.',
});

export default createEndpoint({
  description: 'Permanently delete BV groups with typed confirmation and a durable audit trail (Super Admin only)',
  authenticated: true,
  requiredCapabilities: '*',
  inputSchema,
  outputSchema: z.object({
    deleted: z.number(),
    details: z.array(z.string()),
    auditId: z.string(),
  }),
  execute: async ({ input, context }) => {
    // Repeat the route guard so direct handler calls cannot bypass authorization.
    // Only the server-derived wildcard capability denotes a genuine Super Admin.
    if (!hasApiCapabilities(context.user, '*')) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Super Admin access required' });
    }
    const confirmedInput = inputSchema.parse(input);
    const db = getFirestoreDb();
    if (!db) throw new AppError({ code: 'UNAVAILABLE', message: 'Database unavailable; no groups were deleted.' });
    return deleteBvGroupsWithAudit(db, confirmedInput, context.user);
  },
});
