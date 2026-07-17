import { z } from 'zod';
import { createEndpoint, TagMangoSyncLog, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get TagMango sync log entries with stats (Super Guide only)',
  authenticated: true,
  inputSchema: z.object({
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  outputSchema: z.object({
    records: z.array(z.object({
      id: z.string(),
      timestamp: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      name: z.string().optional(),
      tagMangoUserId: z.string().optional(),
      courseId: z.string().optional(),
      orderId: z.string().optional(),
      mangoName: z.string().optional(),
      amountPaid: z.number().optional(),
      currency: z.string().optional(),
      syncStatus: z.string().optional(),
      eventType: z.string().optional(),
      matchedUser: z.any().optional(),
      rawPayload: z.string().optional(),
    })),
    hasMore: z.boolean(),
    stats: z.object({
      total: z.number(),
      matched: z.number(),
      newUsers: z.number(),
      errors: z.number(),
    }),
  }),
  execute: async ({ input, context }) => {
    if (context.user.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }

    const limit = input.limit || 50;
    const offset = input.offset || 0;

    // Get paginated records
    const { records, hasMore } = await TagMangoSyncLog.findAll({
      limit,
      offset,
    });

    // Get all records for stats (just status field)
    const allRecords = await TagMangoSyncLog.findAll({
      fields: ['syncStatus'],
      limit: 2000,
    });

    let matched = 0, newUsers = 0, errors = 0;
    for (const r of allRecords.records) {
      if (r.syncStatus === 'Matched to Existing User' || r.syncStatus === 'Synced') matched++;
      else if (r.syncStatus === 'New User') newUsers++;
      else if (r.syncStatus === 'Error') errors++;
    }

    return {
      records: records.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        email: r.email,
        phone: r.phone,
        name: r.name,
        tagMangoUserId: r.tagMangoUserId,
        courseId: r.courseId,
        orderId: (r as any).orderId,
        mangoName: (r as any).mangoName,
        amountPaid: (r as any).amountPaid,
        currency: (r as any).currency,
        syncStatus: r.syncStatus,
        eventType: (r as any).eventType,
        matchedUser: r.matchedUser,
        rawPayload: r.rawPayload,
      })),
      hasMore,
      stats: {
        total: allRecords.records.length,
        matched,
        newUsers,
        errors,
      },
    };
  },
});
