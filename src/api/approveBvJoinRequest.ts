import { z } from 'zod';
import { createEndpoint, BvGroupRequests, BvGroupMembers, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Approve or reject a BV group join request',
  authenticated: true,
  inputSchema: z.object({
    requestId: z.string().optional(),
    logId: z.string().optional(),
    action: z.enum(['approve', 'reject']),
    userId: z.string().optional(),
    groupId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const id = input.requestId || input.logId;
    if (!id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'requestId is required' });

    const request = await BvGroupRequests.findOne({ id });
    if (!request) throw new ZiteError({ code: 'NOT_FOUND', message: 'Join request not found' });
    if ((request.status as string) !== 'Pending') throw new ZiteError({ code: 'CONFLICT', message: 'Request already reviewed' });

    const requestUserId = Array.isArray(request.user) ? request.user[0] : request.user as string;
    if (requestUserId === context.user!.id) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Cannot approve your own join request' });
    }

    await BvGroupRequests.update({
      id,
      record: { status: input.action === 'approve' ? 'Approved' : 'Rejected' },
    });

    if (input.action === 'approve') {
      const groupId = Array.isArray(request.group) ? request.group[0] : request.group as string;
      await BvGroupMembers.create({
        record: {
          user: requestUserId,
          group: groupId,
          role: 'Member',
          joinedAt: new Date().toISOString(),
        },
      });
    }

    return { success: true, message: `Join request ${input.action === 'approve' ? 'approved' : 'rejected'}` };
  },
});
