import { z } from 'zod';
import { createEndpoint, BvslPreachingEntries, Users } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';

export default createEndpoint({
  description: 'Get a BVSL preaching entry for a specific date',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    entryDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const dateToUse = input.entryDate || getTodayIST();

    // Resolve DB user id
    let userDbId = context.user.id;
    if (input.userId && input.userId !== context.user.id && input.userId !== context.user.userId) {
      const userRecord = await Users.findOne({ filters: { userId: input.userId }, fields: ['id'] });
      if (userRecord) userDbId = userRecord.id;
    }

    const entry = await BvslPreachingEntries.findOne({
      filters: { user: userDbId, entryDate: dateToUse },
    });

    if (!entry) return { found: false, entry: null };

    return {
      found: true,
      entry: {
        id: entry.id,
        entryDate: (entry.entryDate as string) || dateToUse,
        totalPreachingMinutes: (entry.totalPreachingMinutes as number) || 0,
        submittedAt: (entry.submittedAt as string) || null,
        callingTime: String(entry.prCallingTime || 0),
        oneOnOneTime: String(entry.prOneOnOneTime || 0),
        bookDistTime: String(entry.prBookDistTime || 0),
        rduaTime: String(entry.prRduaTime || 0),
        planTime: String(entry.prPlanTime || 0),
        booksDistributed: (entry.prBooksDistributed as number) || 0,
        contactsCollected: (entry.prContactsCollected as number) || 0,
        uniqueOneOnOnes: (entry.prUniqueOneOnOnes as number) || 0,
      },
    };
  },
});
