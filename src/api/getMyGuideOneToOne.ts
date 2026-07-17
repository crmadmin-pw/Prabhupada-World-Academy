import { z } from 'zod';
import { createEndpoint, Guides, Users, OneToOneMeetings } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: "Get the logged-in user's guide 1:1 booking link and last meeting info, respecting delegation",
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');

    // Fetch fresh user record from DB to resolve actual guide/eligibility columns
    const dbUser = await Users.findOne({ id: context.user.id });
    if (!dbUser) {
      return { hidden: true, guideName: null, guideLink: null, lastMeetingDate: null, lastMeetingWeeksAgo: null, durationMinutes: null, notes: null };
    }

    const eligibility = dbUser.oneToOneEligibility || 'Guide';

    if (eligibility === 'Not Eligible') {
      return { hidden: true, guideName: null, guideLink: null, lastMeetingDate: null, lastMeetingWeeksAgo: null, durationMinutes: null, notes: null };
    }

    if (eligibility === 'Delegated') {
      // Get the delegate (BVSL) info
      const delegateId = Array.isArray(dbUser.oneToOneDelegate)
        ? dbUser.oneToOneDelegate[0]
        : dbUser.oneToOneDelegate;

      if (!delegateId) {
        return { hidden: false, guideName: null, guideLink: null, lastMeetingDate: null, lastMeetingWeeksAgo: null, durationMinutes: null, notes: null };
      }

      const [delegateUser, meetingsRes] = await Promise.all([
        Users.findOne({ id: delegateId, fields: ['id', 'fullName', 'oneToOneLink'] }),
        OneToOneMeetings.findAll({
          filters: { member: context.user.id } as any,
          fields: ['id', 'weekDate', 'meetingDate', 'durationMinutes', 'notes', 'guide'],
          limit: 200,
        }),
      ]);

      // Only meetings logged by this specific delegate
      const meetings = meetingsRes.records.filter(m => {
        const g = Array.isArray(m.guide) ? m.guide[0] : m.guide;
        return g === delegateId;
      });

      let latestMeeting: typeof meetings[0] | null = null;
      if (meetings.length > 0) {
        latestMeeting = meetings.reduce((best, m) => {
          const a = String(m.weekDate || '').split('T')[0];
          const b = String(best.weekDate || '').split('T')[0];
          return a > b ? m : best;
        });
      }

      let lastMeetingDate: string | null = null;
      let lastMeetingWeeksAgo: number | null = null;
      if (latestMeeting) {
        lastMeetingDate = String(latestMeeting.meetingDate || latestMeeting.weekDate || '').split('T')[0];
        const diff = Date.now() - new Date(lastMeetingDate + 'T00:00:00').getTime();
        lastMeetingWeeksAgo = Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
      }

      return {
        hidden: false,
        isDelegated: true,
        guideName: delegateUser?.fullName || null,
        guideLink: delegateUser?.oneToOneLink || null,
        lastMeetingDate,
        lastMeetingWeeksAgo,
        durationMinutes: latestMeeting?.durationMinutes || null,
        notes: latestMeeting?.notes || null,
      };
    }

    // Default: "Guide" eligibility — original behavior
    const guideId = Array.isArray(dbUser.guide)
      ? dbUser.guide[0]
      : dbUser.guide;

    if (!guideId) {
      return { hidden: false, guideName: null, guideLink: null, lastMeetingDate: null, lastMeetingWeeksAgo: null, durationMinutes: null, notes: null };
    }

    const [guideRec, meetingsRes] = await Promise.all([
      Guides.findOne({ id: guideId, fields: ['id', 'fullName', 'oneToOneLink'] }),
      OneToOneMeetings.findAll({
        filters: { member: context.user.id } as any,
        fields: ['id', 'weekDate', 'meetingDate', 'durationMinutes', 'notes'],
        limit: 200,
      }),
    ]);

    const meetings = meetingsRes.records;
    let latestMeeting: typeof meetings[0] | null = null;
    if (meetings.length > 0) {
      latestMeeting = meetings.reduce((best, m) => {
        const a = String(m.weekDate || '').split('T')[0];
        const b = String(best.weekDate || '').split('T')[0];
        return a > b ? m : best;
      });
    }

    let lastMeetingDate: string | null = null;
    let lastMeetingWeeksAgo: number | null = null;
    if (latestMeeting) {
      lastMeetingDate = String(latestMeeting.meetingDate || latestMeeting.weekDate || '').split('T')[0];
      const diff = Date.now() - new Date(lastMeetingDate + 'T00:00:00').getTime();
      lastMeetingWeeksAgo = Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
    }

    return {
      hidden: false,
      isDelegated: false,
      guideName: (guideRec as any)?.fullName || null,
      guideLink: (guideRec as any)?.oneToOneLink || null,
      lastMeetingDate,
      lastMeetingWeeksAgo,
      durationMinutes: latestMeeting?.durationMinutes || null,
      notes: latestMeeting?.notes || null,
    };
  },
});
