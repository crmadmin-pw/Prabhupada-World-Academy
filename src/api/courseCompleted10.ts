import { z } from 'zod';
import { createEndpoint, TagMangoSyncLog, Users } from 'zite-integrations-backend-sdk';

const MILESTONE = 'Course 10% Completed';

export default createEndpoint({
  description: 'Webhook for TagMango course.completed.10 events',
  webhook: { paused: false },
  inputSchema: z.object({
    name: z.string().optional(),
    email: z.string(),
    phone: z.union([z.string(), z.number()]).optional(),
    course: z.string().optional(),
    courseId: z.string().optional(),
    lastProgressOn: z.string().optional(),
  }).passthrough(),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    try {
      const emailLower = input.email.toLowerCase().trim();
      const idempotencyKey = `${input.courseId || ''}_${emailLower}_10`;

      const existing = await TagMangoSyncLog.findOne({
        filters: { orderId: idempotencyKey },
      });
      if (existing) return { success: true };

      const user = await Users.findOne({ filters: { email: emailLower } });

      await TagMangoSyncLog.create({
        record: {
          orderId: idempotencyKey,
          timestamp: input.lastProgressOn || new Date().toISOString(),
          email: emailLower,
          phone: input.phone != null ? String(input.phone) : undefined,
          name: input.name,
          courseId: input.courseId || '',
          mangoName: input.course || '',
          syncStatus: user ? 'Matched to Existing User' : 'New User',
          matchedUser: user?.id,
          rawPayload: JSON.stringify({ ...input, eventType: MILESTONE }),
        },
      });

      return { success: true };
    } catch (err) {
      console.error('courseCompleted10 webhook error:', err);
      return { success: true };
    }
  },
});
