import { z } from 'zod';
import { createEndpoint, OneToOneMeetings, Guides, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Log or update a one-to-one meeting (upserts by guide×member×week)',
  authenticated: true,
  inputSchema: z.object({
    memberId: z.string(),
    weekDate: z.string(),
    meetingDate: z.string(),
    durationMinutes: z.number(),
    notes: z.string().optional(),
    guideId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    let guideId = context.user!.id;

    // If Sadhana Mentor, allow acting on behalf of their guide
    if (input.guideId && context.user!.isSadhanaMentor) {
      const mentorGuideRef = Array.isArray(context.user!.guide) ? context.user!.guide[0] : context.user!.guide;
      // Validate the mentor belongs to the specified guide
      const guide = await Guides.findOne({ id: mentorGuideRef || '', fields: ['id'] });
      if (!guide || guide.id !== input.guideId) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only log meetings for your assigned guide' });
      }
      guideId = input.guideId;
    }
    const record = {
      meetingDate: input.meetingDate,
      durationMinutes: input.durationMinutes,
      notes: input.notes || '',
    };

    const existing = await OneToOneMeetings.findOne({
      filters: { guide: guideId, member: input.memberId, weekDate: input.weekDate } as any,
    });

    if (existing) {
      await OneToOneMeetings.update({ id: existing.id, record });
      return {
        id: existing.id,
        created: false,
        memberId: input.memberId,
        weekDate: input.weekDate,
        meetingDate: input.meetingDate,
        durationMinutes: input.durationMinutes,
        notes: input.notes || '',
        guideId,
      };
    }

    const created = await OneToOneMeetings.create({
      record: { guide: guideId, member: input.memberId, weekDate: input.weekDate, ...record },
    });
    return {
      id: created.id,
      created: true,
      memberId: input.memberId,
      weekDate: input.weekDate,
      meetingDate: input.meetingDate,
      durationMinutes: input.durationMinutes,
      notes: input.notes || '',
      guideId,
    };
  },
});
