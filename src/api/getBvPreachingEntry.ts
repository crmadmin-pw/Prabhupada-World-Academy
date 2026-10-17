import { z } from 'zod';
import { AppError, createEndpoint, BvslPreachingEntries, Users } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, HIERARCHY_IDENTITY_FIELDS, isUserInHierarchy } from '@/lib/hierarchyUtils';
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
      const fields = [...HIERARCHY_IDENTITY_FIELDS];
      const userRecord = await Users.findOne({ filters: { userId: input.userId }, fields })
        || await Users.findOne({ id: input.userId, fields });
      if (userRecord) {
        // Same rule as the profile's CRM data and the sadhana entry detail:
        // another member's entry is visible only inside the caller's hierarchy.
        if (userRecord.id !== context.user.id
          && !isUserInHierarchy(userRecord, await getScopedHierarchyUserIds(context.user))) {
          throw new AppError({ code: 'FORBIDDEN', message: 'This user is not assigned to your hierarchy' });
        }
        userDbId = userRecord.id;
      }
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
