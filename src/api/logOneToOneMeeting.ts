import { z } from 'zod';
import { createEndpoint, OneToOneMeetings, Guides, Users, AppError } from '@/lib/backend-sdk';

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
    callStatus: z.enum(['Connected', 'Did not answer', 'Did not place the call']).optional(),
    recordingLink: z.string().optional(),
    nextCallDate: z.string().optional(),
    nextCallAgenda: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    let guideId = context.user!.id;
    const callerRole = String(context.user!.role || '').toUpperCase().replace(/[\s-]+/g, '_');
    const isSadhanaMentor = !!context.user!.isSadhanaMentor || callerRole === 'SADHANA_MENTOR';
    const normalizedSegment = String(context.user!.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    const isPwSadhanaMentor = isSadhanaMentor && normalizedSegment !== 'FOLK';

    if (isPwSadhanaMentor) {
      const mentor = await Users.findOne({ id: context.user!.id, fields: ['id', 'userId', 'email'] })
        || await Users.findOne({ filters: { email: context.user!.email }, fields: ['id', 'userId', 'email'] });
      const member = await Users.findOne({ id: input.memberId, fields: ['id', 'sadhanaMentor'] });
      const mentorRefs = new Set(
        [context.user!.id, mentor?.id, (mentor as any)?.userId, context.user!.email]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(Boolean),
      );
      if (!member || !mentorRefs.has(String((member as any).sadhanaMentor || '').trim().toLowerCase())) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only log meetings for members assigned to you' });
      }
      guideId = mentor?.id || context.user!.id;
    }

    // Elevated roles (supervisors/admins/super-admins) can act on behalf of any RGF
    const isElevated = context.user!.isBvSupervisor ||
      context.user!.isBvAdmin ||
      context.user!.isBvSuperAdmin ||
      context.user!.role === 'SUPER_ADMIN';

    if (input.guideId && isElevated && !isPwSadhanaMentor) {
      // Admin acting on behalf of an RGF — use the provided guideId directly
      guideId = input.guideId;
    } else if (input.guideId && context.user!.isSadhanaMentor && !isPwSadhanaMentor) {
      // Sadhana Mentor: validate they belong to the specified guide
      const mentorGuideRef = Array.isArray(context.user!.guide) ? context.user!.guide[0] : context.user!.guide;
      const guide = await Guides.findOne({ id: mentorGuideRef || '', fields: ['id'] });
      if (!guide || guide.id !== input.guideId) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only log meetings for your assigned guide' });
      }
      guideId = input.guideId;
    }
    const record = {
      meetingDate: input.meetingDate,
      durationMinutes: input.durationMinutes,
      notes: input.notes || '',
      callStatus: input.callStatus || 'Connected',
      recordingLink: input.recordingLink || '',
      nextCallDate: input.nextCallDate || '',
      nextCallAgenda: input.nextCallAgenda || '',
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
        ...record,
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
      ...record,
      guideId,
    };
  },
});
