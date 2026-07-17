import { z } from 'zod';
import { createEndpoint, OneToOneMeetings, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Delete a one-to-one meeting record',
  authenticated: true,
  inputSchema: z.object({ meetingId: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const meeting = await OneToOneMeetings.findOne({ id: input.meetingId });
    if (!meeting) throw new ZiteError({ code: 'NOT_FOUND', message: 'Meeting not found' });

    const guideId = Array.isArray(meeting.guide) ? meeting.guide[0] : meeting.guide;
    const isOwner = guideId === context.user!.id;
    // Sadhana Mentors can delete meetings for their assigned guide
    let isMentorForGuide = false;
    if (!isOwner && context.user!.isSadhanaMentor) {
      const mentorGuideRef = Array.isArray(context.user!.guide) ? context.user!.guide[0] : context.user!.guide;
      isMentorForGuide = !!mentorGuideRef && mentorGuideRef === guideId;
    }
    if (!isOwner && !isMentorForGuide) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only delete your own meeting records' });
    }

    await OneToOneMeetings.delete({ id: input.meetingId });
    return { success: true };
  },
});
