import { z } from 'zod';
import { createEndpoint, Users, Guides, ZiteError } from 'zite-integrations-backend-sdk';
import { getGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Get BV Mentor dashboard data — returns the resolved Guides-table UUID they are assigned to manage',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    guideId: z.string(),
    mentorName: z.string(),
    residencyIds: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const userRecord = await Users.findOne({
      filters: { email: context.user!.email },
      fields: ['id', 'fullName', 'isBvMentor', 'bvMentorGuideId'],
    }) as any;

    if (!userRecord?.isBvMentor) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'BV Mentor access required' });
    }

    const rawId: string = userRecord.bvMentorGuideId;
    if (!rawId) {
      throw new ZiteError({
        code: 'NOT_FOUND',
        message: 'No guide assigned to your BV Mentor account. Please ask a Super Guide to assign you to a guide.',
      });
    }

    // Step 1: Try direct Guides-table lookup (covers Super Guide who stored a Guides-table UUID)
    let resolvedGuideId: string | null = null;
    try {
      const directGuide = await Guides.findOne({ id: rawId, fields: ['id'] });
      if (directGuide?.id) resolvedGuideId = directGuide.id;
    } catch { /* not a Guides-table UUID */ }

    // Step 2: rawId is a Users-table UUID (Guide tagged via context.user.id) — resolve via email
    if (!resolvedGuideId) {
      try {
        const guideUser = await Users.findOne({ id: rawId, fields: ['email'] }) as any;
        if (guideUser?.email) {
          const guideRec = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] }) as any;
          if (guideRec?.id) resolvedGuideId = guideRec.id;
        }
      } catch { /* ignore */ }
    }

    if (!resolvedGuideId) {
      throw new ZiteError({
        code: 'NOT_FOUND',
        message: 'Could not resolve the assigned guide. Please ask a Super Guide to reassign your BV Mentor role.',
      });
    }

    // Resolve guide's folkResidencies for center-based scoping
    const guideRecord = await Guides.findOne({ id: resolvedGuideId, fields: ['id', 'folkResidencies'] });
    const residencyIds: string[] = Array.isArray(guideRecord?.folkResidencies)
      ? (guideRecord!.folkResidencies as string[])
      : (guideRecord?.folkResidencies ? [guideRecord!.folkResidencies as string] : []);

    return {
      guideId: resolvedGuideId,
      mentorName: userRecord.fullName || '',
      residencyIds,
    };
  },
});
