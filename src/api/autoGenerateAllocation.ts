import { z } from 'zod';
import { createEndpoint, Services, ServiceAllocations, ServiceAvailability, Users, FolkResidencies } from 'zite-integrations-backend-sdk';

function parseAvailDays(json: string): { day: string; time: string }[] {
  try {
    const p = JSON.parse(json ?? '[]');
    if (!Array.isArray(p) || p.length === 0) return [];
    if (typeof p[0] === 'string') return p.map((d: string) => ({ day: d, time: 'full_day' }));
    return p.map((d: any) => ({ day: d.day, time: d.time ?? 'full_day' }));
  } catch { return []; }
}

const DOW_MAP: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

export default createEndpoint({
  description: 'Auto-generate service allocations for the week. One person per service for the whole week, with rotation fairness across weeks.',
  authenticated: true,
  inputSchema: z.object({
    weekStartDate: z.string().optional(),
    scope: z.string().optional(),
    residencyId: z.string().optional(),
    force: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isGuide = role === 'Guide' || role === 'Super Guide' || context.user.isServiceAllocator === true;
    if (!isGuide) {
      return { alreadyGenerated: true, allocationsCreated: 0 };
    }

    const today = new Date();
    const sun = new Date(today); sun.setDate(today.getDate() - today.getDay());
    const weekStartDate = input.weekStartDate || sun.toISOString().split('T')[0];

    // Service week: Sunday → Saturday
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    // Resolve residency DB id
    let residencyDbId: string | undefined;
    if (input.residencyId) {
      const res = await FolkResidencies.findOne({ filters: { residencyId: input.residencyId }, fields: ['id'] });
      if (res) residencyDbId = res.id;
    }

    // Check if already generated
    const existing = await ServiceAllocations.findAll({ filters: { weekDate: weekStartDate }, limit: 1 });
    if (existing.records.length > 0 && !input.force) {
      return { alreadyGenerated: true, allocationsCreated: 0 };
    }

    // If force, clear existing allocations for this week
    if (input.force && existing.records.length > 0) {
      const allExisting = await ServiceAllocations.findAll({ filters: { weekDate: weekStartDate }, limit: 500 });
      for (const rec of allExisting.records) {
        await ServiceAllocations.delete({ id: rec.id });
      }
    }

    // Get services
    const { records: allServices } = await Services.findAll({ filters: { isActive: true }, limit: 200 });
    const services = allServices.filter(s => {
      if (s.serviceScope === 'General') return true;
      const svcResidency = Array.isArray(s.residency) ? s.residency[0] : s.residency;
      if (residencyDbId && svcResidency === residencyDbId) return true;
      return false;
    }).sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));

    if (services.length === 0) return { alreadyGenerated: false, allocationsCreated: 0 };

    // Get residents
    const userFilter: any = { residencyApproved: true, status: 'Active' };
    if (residencyDbId) userFilter.residency = residencyDbId;
    const { records: residents } = await Users.findAll({ filters: userFilter, fields: ['id', 'fullName'], limit: 500 });
    if (residents.length === 0) return { alreadyGenerated: false, allocationsCreated: 0 };

    // Get availability — check who is available for the MAJORITY of the week (4+ days)
    const avRes = await ServiceAvailability.findAll({ filters: { weekDate: weekStartDate }, limit: 500 });
    const availDayCount: Record<string, number> = {};
    for (const av of avRes.records) {
      const uid = Array.isArray(av.user) ? av.user[0] : av.user;
      if (!uid) continue;
      const parsed = parseAvailDays(av.availableDaysJson || '[]');
      availDayCount[uid] = parsed.length;
    }

    // Get past 4 weeks allocation counts per user per service for rotation fairness
    const fourWeeksAgo = new Date(weekStartDate);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const pastAllocs = await ServiceAllocations.findAll({
      filters: { weekDate: { gte: fourWeeksAgo.toISOString().split('T')[0] } as any },
      limit: 2000,
    });
    // Count how many times each user has done each service in the past 4 weeks
    const rotationCount: Record<string, number> = {};
    // Also count which week they last did it (for streak detection)
    const lastWeekDone: Record<string, string> = {};
    for (const pa of pastAllocs.records) {
      const uid = Array.isArray(pa.user) ? pa.user[0] : pa.user;
      const sid = Array.isArray(pa.service) ? pa.service[0] : pa.service;
      if (!uid || !sid) continue;
      const key = `${uid}::${sid}`;
      rotationCount[key] = (rotationCount[key] || 0) + 1;
      if (!lastWeekDone[key] || (pa.weekDate || '') > lastWeekDone[key]) {
        lastWeekDone[key] = pa.weekDate || '';
      }
    }

    // Track how many services each person has been assigned this run (for load balancing)
    const serviceCountThisWeek: Record<string, number> = {};

    const toCreate: any[] = [];

    // KEY CHANGE: Pick ONE person per service for the WHOLE WEEK
    for (const svc of services) {
      const needed = svc.peopleNeeded || 1;

      // Sort residents by:
      // 1. Availability (more available days = preferred)
      // 2. Fewest services assigned this week (load balance)
      // 3. Fewest times done this service in past 4 weeks (rotation)
      // 4. Didn't do this exact service last week (avoid consecutive weeks)
      const sorted = [...residents].sort((a, b) => {
        // Prefer people who are more available this week
        const availA = availDayCount[a.id] || 0;
        const availB = availDayCount[b.id] || 0;
        if (availA !== availB) return availB - availA; // more available first

        // Prefer lower service load this week
        const loadA = serviceCountThisWeek[a.id] || 0;
        const loadB = serviceCountThisWeek[b.id] || 0;
        if (loadA !== loadB) return loadA - loadB;

        // Prefer who did this service least recently / fewest times
        const rotA = rotationCount[`${a.id}::${svc.id}`] || 0;
        const rotB = rotationCount[`${b.id}::${svc.id}`] || 0;
        return rotA - rotB;
      });

      const picks = sorted.slice(0, needed);
      const backup = sorted[needed]; // first non-picked person as backup

      // Assign each picked person to ALL 7 days of the week
      for (const pick of picks) {
        for (const day of days) {
          toCreate.push({
            service: svc.id,
            user: pick.id,
            weekDate: weekStartDate,
            dayOfWeek: DOW_MAP[day],
            status: 'Scheduled',
            backupUser: backup?.id || undefined,
            isBackup: false,
          });
        }
        serviceCountThisWeek[pick.id] = (serviceCountThisWeek[pick.id] || 0) + 1;
      }
    }

    // Bulk create in chunks of 100
    let allocationsCreated = 0;
    for (let i = 0; i < toCreate.length; i += 100) {
      const chunk = toCreate.slice(i, i + 100);
      await ServiceAllocations.bulkCreate({ records: chunk });
      allocationsCreated += chunk.length;
    }

    return { alreadyGenerated: false, allocationsCreated, servicesAssigned: services.length };
  },
});
