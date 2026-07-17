import { z } from 'zod';
import { createEndpoint, TagMangoSyncLog, Users, Config } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Webhook endpoint for TagMango order.created.completed events',
  webhook: {
    "paused": false
  },
  inputSchema: z.object({
    subscriberId: z.string(),
    name: z.string().optional(),
    email: z.string(),
    phone: z.union([z.string(), z.number()]).optional(),
    orderId: z.string(),
    orderTime: z.string().optional(),
    amount: z.any().optional(),
    amountPayable: z.any().optional(),
    mangoName: z.string().optional(),
    status: z.string().optional(),
    currency: z.string().optional(),
    gst: z.any().optional(),
    discount: z.any().optional(),
    coupon: z.any().optional(),
    quantity: z.any().optional(),
    customFields: z.any().optional(),
    mangoId: z.string().optional(),
  }).passthrough(),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    try {
      // Idempotency: check if orderId already exists
      const existing = await TagMangoSyncLog.findOne({
        filters: { orderId: input.orderId },
      });
      if (existing) {
        return { success: true };
      }

      // Match user by email (case-insensitive)
      const emailLower = input.email.toLowerCase().trim();
      const userResult = await Users.findOne({
        filters: { email: emailLower },
      });

      let syncStatus = 'New User';
      let matchedUserId: string | undefined;

      if (userResult) {
        matchedUserId = userResult.id;
        syncStatus = 'Matched to Existing User';

        // Reverse-lookup Ashray level from per-center course config
        let enrolledLevel: string | undefined;
        try {
          const configRecord = await Config.findOne({
            filters: { configKey: 'course_config' },
          });
          if (configRecord?.configValue && input.mangoId) {
            const courseConfig = JSON.parse(configRecord.configValue) as Record<string, Record<string, string>>;
            // Search across all centers for the mangoId
            outer:
            for (const centerConfig of Object.values(courseConfig)) {
              for (const [level, mangoId] of Object.entries(centerConfig)) {
                if (mangoId === input.mangoId) {
                  enrolledLevel = level;
                  break outer;
                }
              }
            }
          }
        } catch { /* ignore config lookup errors */ }

        // Update user record
        const updateFields: Record<string, any> = {
          tagMangoEnrollmentStatus: 'Enrolled',
          tagMangoUserId: input.subscriberId,
        };
        if (enrolledLevel) {
          updateFields.enrolledLevel = enrolledLevel;
        }
        await Users.update({ id: userResult.id, record: updateFields });
      }

      // Create sync log record
      await TagMangoSyncLog.create({
        record: {
          timestamp: input.orderTime || new Date().toISOString(),
          email: emailLower,
          phone: input.phone != null ? String(input.phone) : undefined,
          name: input.name,
          tagMangoUserId: input.subscriberId,
          courseId: input.mangoName || '',
          orderId: input.orderId,
          mangoName: input.mangoName || '',
          amountPaid: input.amountPayable != null ? Number(input.amountPayable) : undefined,
          currency: input.currency || '',
          syncStatus,
          matchedUser: matchedUserId || undefined,
          rawPayload: JSON.stringify(input),
        },
      });

      return { success: true };
    } catch (err) {
      console.error('TagMango webhook error:', err);
      return { success: true };
    }
  },
});
