import { z } from 'zod';
import { createEndpoint, Guides, Users, OneToOneMeetings } from 'zite-integrations-backend-sdk';

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
  description: 'Get one-to-one meeting matrix for a guide',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string().optional(),
    weeksBack: z.number().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    const weeksBack = input.weeksBack || 8;
    const weeks = getWeeks(weeksBack);
    const startDate = weeks[0];
    const endDate = weeks[weeks.length - 1];

    const isSadhanaMentor = !!context.user.isSadhanaMentor;
    let guideDbId = input.guideId;
    let guideOneToOneLink: string | null = null;
    if (!guideDbId && !isSuperGuide) {
      if (isSadhanaMentor && !context.user.role?.includes('Guide')) {
        // Sadhana Mentor: resolve guide from their linked guide record
        const mentorGuideId = Array.isArray(context.user.guide) ? context.user.guide[0] : context.user.guide;
        if (mentorGuideId) {
          const g = await Guides.findOne({ id: mentorGuideId, fields: ['id', 'oneToOneLink'] });
          guideDbId = g?.id;
          guideOneToOneLink = (g as any)?.oneToOneLink || null;
        }
      } else {
        const g = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id', 'oneToOneLink'] });
        guideDbId = g?.id;
        guideOneToOneLink = (g as any)?.oneToOneLink || null;
      }
    } else if (guideDbId) {
      const g = await Guides.findOne({ id: guideDbId, fields: ['id', 'oneToOneLink'] });
      guideOneToOneLink = (g as any)?.oneToOneLink || null;
    }

    let availableGuides: { guideId: string; guideName: string }[] = [];
    if (isSuperGuide) {
      const { records } = await Guides.findAll({ filters: { isActive: true }, fields: ['id', 'fullName'], limit: 100 });
      availableGuides = records.map(g => ({ guideId: g.id, guideName: (g as any).fullName || '' }));
    }

    if (!guideDbId) return { users: [], meetings: [], weeks, availableGuides };

    const [usersRes, bvslRes] = await Promise.all([
      Users.findAll({
        filters: { guide: guideDbId, status: 'Active' },
        fields: ['id', 'fullName', 'ashrayLevel', 'residencyApproved', 'oneToOneEligibility', 'oneToOneDelegate'],
        limit: 500,
      }),
      Users.findAll({
        filters: { guide: guideDbId, isBvsl: true, status: 'Active' },
        fields: ['id', 'fullName'],
        limit: 100,
      }),
    ]);

    const users = usersRes.records;

    // Batch fetch delegate names
    const delegateIds = [...new Set(
      users.map(u => {
        const d = u.oneToOneDelegate;
        return Array.isArray(d) ? d[0] : d;
      }).filter(Boolean) as string[]
    )];

    let delegateNames: Record<string, string> = {};
    if (delegateIds.length > 0) {
      const { records: delegates } = await Users.findAll({
        filters: { id: { in: delegateIds } },
        fields: ['id', 'fullName'],
        limit: 100,
      });
      delegateNames = Object.fromEntries(delegates.map(d => [d.id, d.fullName || '']));
    }

    const userIds = users.map(u => u.id);
    let meetings: any[] = [];
    if (userIds.length > 0) {
      const { records } = await OneToOneMeetings.findAll({
        filters: { weekDate: { gte: startDate, lte: endDate } } as any,
        fields: ['id', 'guide', 'member', 'weekDate', 'meetingDate', 'durationMinutes', 'notes'],
        limit: 2000,
      });
      meetings = records.filter(m => {
        const mid = Array.isArray(m.member) ? m.member[0] : m.member;
        return mid && userIds.includes(mid);
      });
    }

    return {
      users: users.map(u => {
        const delegateId = Array.isArray(u.oneToOneDelegate) ? u.oneToOneDelegate[0] : u.oneToOneDelegate;
        return {
          userId: u.id,
          fullName: u.fullName || '',
          ashrayLevel: u.ashrayLevel || null,
          isResident: u.residencyApproved || false,
          eligibility: u.oneToOneEligibility || 'Guide',
          delegateId: delegateId || null,
          delegateName: delegateId ? (delegateNames[delegateId] || null) : null,
        };
      }),
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
      availableGuides,
      guideLink: guideOneToOneLink,
      availableBvsls: bvslRes.records.map(b => ({ userId: b.id, fullName: b.fullName || '' })),
    };
  },
});
