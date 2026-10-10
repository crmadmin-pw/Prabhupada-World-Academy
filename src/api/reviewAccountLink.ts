import { z } from 'zod';
import { createEndpoint, AppError } from '@/lib/backend-sdk';
import { canReviewAccountLinks, reviewAccountLinkRequest } from '@/lib/accountLinkReview';

export default createEndpoint({
  description: 'Approve, reject, or reopen a reviewed login-to-profile link',
  authenticated: true,
  requiredCapabilities: 'system.admin',
  inputSchema: z.object({
    requestId: z.string().min(1).max(200),
    action: z.enum(['approve', 'reject', 'reopen']),
    profileId: z.string().max(200).optional(),
    notes: z.string().max(1000).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    status: z.enum(['Approved', 'Rejected', 'Pending']),
  }),
  execute: async ({ input, context }: any) => {
    if (!canReviewAccountLinks(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only an administrator can review account links' });
    }
    return reviewAccountLinkRequest({
      requestId: input.requestId,
      action: input.action,
      profileId: input.profileId,
      notes: input.notes,
      reviewerId: String(context.user.id || context.user.uid || context.user.email || ''),
    });
  },
});
