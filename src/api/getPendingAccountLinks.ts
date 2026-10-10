import { z } from 'zod';
import { createEndpoint, AccountLinkRequests, AppError } from '@/lib/backend-sdk';
import { canReviewAccountLinks } from '@/lib/accountLinkReview';

export default createEndpoint({
  description: 'List login-to-profile links waiting for an administrator to confirm',
  authenticated: true,
  requiredCapabilities: 'system.admin',
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!canReviewAccountLinks(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only an administrator can review account links' });
    }
    const { records } = await AccountLinkRequests.findAll({ limit: 200 });
    return records
      .filter((request: any) => request.status === 'Pending' || request.status === 'Rejected')
      .map((request: any) => ({
        id: request.id,
        email: request.email,
        status: request.status,
        createdAt: request.createdAt || null,
        updatedAt: request.updatedAt || null,
        reviewedAt: request.reviewedAt || null,
        notes: request.notes || '',
        bareRecordId: request.bareRecordId || null,
        candidates: Array.isArray(request.candidates) ? request.candidates : [],
      }))
      .sort((left: any, right: any) => {
        if (left.status !== right.status) return left.status === 'Pending' ? -1 : 1;
        return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
      });
  },
});
