import { z } from 'zod';
import { createEndpoint, PreachingReportGoals, ZiteError } from 'zite-integrations-backend-sdk';
import { getGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Save/upsert preaching report goals per metric per center',
  authenticated: true,
  inputSchema: z.object({
    goals: z.array(z.object({
      metricName: z.string(),
      centerId: z.string(),
      yearlyGoal: z.number(),
      initialValue: z.number(),
      year: z.number(),
    })),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role;
    const isSuperGuide = role === 'Super Guide';
    const isGuide = role === 'Guide';

    if (!isSuperGuide && !isGuide) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    // Guides can only save goals for their own centers
    if (isGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide record not found' });
      const outOfScope = input.goals.find(g => !scope.residencyIds.includes(g.centerId));
      if (outOfScope) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only set goals for your own center(s)' });
      }
    }

    const records = input.goals.map(g => ({
      metricName: g.metricName,
      center: g.centerId,
      yearlyGoal: g.yearlyGoal,
      initialValue: g.initialValue,
      year: g.year,
    }));

    // Process in batches of 100
    for (let i = 0; i < records.length; i += 100) {
      const batch = records.slice(i, i + 100);
      await PreachingReportGoals.bulkCreate({
        records: batch,
        matchOn: ['metricName', 'center', 'year'],
      });
    }

    return { success: true };
  },
});
