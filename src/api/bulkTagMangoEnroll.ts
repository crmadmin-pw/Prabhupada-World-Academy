import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { enrollUserOnTagMango, resolveApiKey } from '../lib/tagMangoEnroll';

export default createEndpoint({
  description: 'Bulk enroll eligible active users on TagMango who are not yet enrolled',
  authenticated: true,
  inputSchema: z.object({
    dryRun: z.boolean().optional(),
  }),
  outputSchema: z.object({
    eligible: z.number(),
    enrolled: z.number(),
    failed: z.number(),
    skipped: z.number(),
    errors: z.array(z.object({ name: z.string(), error: z.string() })),
  }),
  execute: async ({ input, context }) => {
    if (context.user.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }

    const apiKey = await resolveApiKey();
    if (!apiKey) throw new ZiteError({ code: 'BAD_REQUEST', message: 'TagMango API key not configured' });

    // Fetch all active users with an ashray level who are not yet enrolled
    const allUsers: { id: string; fullName?: string; email?: string; phone?: string; ashrayLevel?: string; tagMangoEnrollmentStatus?: string; tagMangoEnrollmentAttempts?: number }[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const batch = await Users.findAll({
        filters: { status: 'Active', ashrayLevel: { not: '' } },
        fields: ['id', 'fullName', 'email', 'phone', 'ashrayLevel', 'tagMangoEnrollmentStatus', 'tagMangoEnrollmentAttempts'],
        limit: 500,
        offset,
      });
      allUsers.push(...(batch.records as any[]));
      hasMore = batch.hasMore;
      offset += batch.records.length;
    }

    // Filter to only those not enrolled
    const eligible = allUsers.filter(u =>
      u.ashrayLevel &&
      (!u.tagMangoEnrollmentStatus || u.tagMangoEnrollmentStatus === 'Failed')
    );

    if (input.dryRun) {
      return { eligible: eligible.length, enrolled: 0, failed: 0, skipped: 0, errors: [] };
    }

    let enrolled = 0;
    let failed = 0;
    let skipped = 0;
    const errors: { name: string; error: string }[] = [];

    for (const user of eligible) {
      const result = await enrollUserOnTagMango({
        userId: user.id,
        name: user.fullName || '',
        email: user.email || '',
        phone: user.phone || '',
        ashrayLevel: user.ashrayLevel,
        currentAttempts: user.tagMangoEnrollmentAttempts || 0,
      });

      if (result.status === 'Enrolled') enrolled++;
      else if (result.status === 'Failed') {
        failed++;
        errors.push({ name: user.fullName || user.email || user.id, error: result.error || 'Unknown error' });
      } else skipped++;
    }

    return { eligible: eligible.length, enrolled, failed, skipped, errors: errors.slice(0, 50) };
  },
});
