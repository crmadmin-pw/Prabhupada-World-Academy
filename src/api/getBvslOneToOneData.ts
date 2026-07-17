import { z } from 'zod';
import { createEndpoint, Users, OneToOneMeetings } from 'zite-integrations-backend-sdk';

function getWeeks(weeksBack: number): string[] {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  const weeks: string[] = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(monday.getDate() - i * 7);
    weeks.push(d.toISOString().split('T')[0]);
  }
  return weeks;
}

export default createEndpoint({
  description: 'Get 1:1 meeting data for a BVSL — their delegated members and meetings',
  authenticated: true,
  inputSchema: z.object({ weeksBack: z.number().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const weeksBack = input.weeksBack || 8;
    const weeks = getWeeks(weeksBack);
    const startDate = weeks[0];
    const endDate = weeks[weeks.length - 1];

    // Get the BVSL's own link
    const bvslUser = await Users.findOne({
      id: context.user.id,
      fields: ['id', 'fullName', 'oneToOneLink'],
    });

    // Find users delegated to this BVSL
    const { records: users } = await Users.findAll({
      filters: {
        oneToOneDelegate: context.user.id,
        oneToOneEligibility: 'Delegated',
        status: 'Active',
      } as any,
      fields: ['id', 'fullName', 'ashrayLevel', 'residencyApproved'],
      limit: 500,
    });

    const userIds = users.map(u => u.id);
    let meetings: any[] = [];
    if (userIds.length > 0) {
      const { records } = await OneToOneMeetings.findAll({
        filters: { guide: context.user.id, weekDate: { gte: startDate, lte: endDate } } as any,
        fields: ['id', 'guide', 'member', 'weekDate', 'meetingDate', 'durationMinutes', 'notes'],
        limit: 2000,
      });
      meetings = records.filter(m => {
        const mid = Array.isArray(m.member) ? m.member[0] : m.member;
        return mid && userIds.includes(mid);
      });
    }

    return {
      bvslLink: bvslUser?.oneToOneLink || null,
      users: users.map(u => ({
        userId: u.id,
        fullName: u.fullName || '',
        ashrayLevel: u.ashrayLevel || null,
        isResident: u.residencyApproved || false,
        eligibility: 'Delegated',
        delegateId: context.user.id,
        delegateName: null,
      })),
      meetings: meetings.map(m => ({
        id: m.id,
        guideId: Array.isArray(m.guide) ? m.guide[0] : m.guide,
        memberId: Array.isArray(m.member) ? m.member[0] : m.member,
        weekDate: String(m.weekDate || '').split('T')[0],
        meetingDate: String(m.meetingDate || '').split('T')[0],
        durationMinutes: m.durationMinutes || 0,
        notes: m.notes || '',
      })),
      weeks,
    };
  },
});
