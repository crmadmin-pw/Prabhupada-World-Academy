import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services, Users, FolkResidencies } from 'zite-integrations-backend-sdk';
import { getServiceWeekStartOf } from '../lib/serviceWeek';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export default createEndpoint({
  description: 'Get today\'s service board for a residency',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    // Determine today in IST
    const nowIST = new Date(Date.now() + IST_OFFSET_MS);
    const todayISO = nowIST.toISOString().split('T')[0]; // yyyy-MM-dd
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDayName = DAY_NAMES[nowIST.getUTCDay()];
    const weekStartSunday = getServiceWeekStartOf(nowIST);

    // Current IST hour+minute as minutes-since-midnight for overdue calculation
    const istMinutes = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();

    // Resolve residency
    let residencyDbId: string | undefined;
    const rawResidency = input.residencyId || (Array.isArray(context.user.residency) ? context.user.residency[0] : context.user.residency);

    if (rawResidency) {
      const byCustomId = await FolkResidencies.findOne({ filters: { residencyId: rawResidency }, fields: ['id'] });
      if (byCustomId) {
        residencyDbId = byCustomId.id;
      } else {
        const byDbId = await FolkResidencies.findOne({ id: rawResidency, fields: ['id'] });
        residencyDbId = byDbId?.id;
      }
    }

    // Fetch active services for this residency
    const { records: allServices } = await Services.findAll({ filters: { isActive: true }, limit: 200 });
    const relevantServices = allServices.filter(s => {
      if (s.serviceScope === 'General') return true;
      const svcResidency = Array.isArray(s.residency) ? s.residency[0] : s.residency;
      if (residencyDbId && svcResidency === residencyDbId) return true;
      return false;
    }).sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));

    // Fetch allocations for today (include notes for checklist progress)
    const allocRes = await ServiceAllocations.findAll({
      filters: { weekDate: weekStartSunday, dayOfWeek: todayDayName },
      limit: 300,
      fields: ['id', 'allocationId', 'service', 'user', 'dayOfWeek', 'status', 'completedAt', 'notes'],
    });
    const allocations = allocRes.records;

    // Build user map
    const userIds = [...new Set(allocations.map(a => (Array.isArray(a.user) ? a.user[0] : a.user)).filter(Boolean))] as string[];
    const userMap: Record<string, { name: string; firstName: string }> = {};
    if (userIds.length > 0) {
      const usersRes = await Users.findAll({
        filters: { id: { in: userIds } },
        fields: ['id', 'fullName', 'userId'],
        limit: 200,
      });
      usersRes.records.forEach(u => {
        const full = u.fullName || u.userId || '';
        const firstName = full.split(' ')[0] || full;
        userMap[u.id] = { name: full, firstName };
      });
    }

    // Build allocation map: serviceId -> allocation
    const allocByService: Record<string, any> = {};
    for (const a of allocations) {
      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      if (!svcId) continue;
      allocByService[svcId] = a;
    }

    // Parse time slot to minutes (e.g. "6:00 AM" -> 360)
    const parseTimeSlot = (slot: string): number => {
      if (!slot) return 999;
      const match = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!match) return 999;
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const period = match[3].toUpperCase();
      if (period === 'PM' && h !== 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };

    // Build service rows
    const services = relevantServices.map(svc => {
      const alloc = allocByService[svc.id];
      const timeSlotMinutes = parseTimeSlot(svc.timeSlot || '');
      const isPast = istMinutes > timeSlotMinutes + 30; // 30 min grace

      let status: 'completed' | 'pending' | 'overdue' | 'unassigned';
      let assigneeName: string | null = null;
      let assigneeFirstName: string | null = null;
      let allocationId: string | null = null;
      let assigneeDbId: string | null = null;
      let notes: string = '';

      if (!alloc) {
        status = 'unassigned';
      } else {
        const userId = Array.isArray(alloc.user) ? alloc.user[0] : alloc.user;
        const info = userMap[userId || ''];
        assigneeName = info?.name || null;
        assigneeFirstName = info?.firstName || null;
        assigneeDbId = userId || null;
        allocationId = alloc.allocationId || alloc.id;
        notes = alloc.notes || '';

        const rawStatus = (alloc.status || 'Scheduled').toLowerCase();
        if (rawStatus === 'done') {
          status = 'completed';
        } else if (isPast) {
          status = 'overdue';
        } else {
          status = 'pending';
        }
      }

      return {
        serviceId: svc.id,
        serviceName: svc.serviceName || '',
        timeSlot: svc.timeSlot || '',
        description: svc.description || '',
        status,
        assigneeName,
        assigneeFirstName,
        assigneeDbId,
        allocationId,
        serviceDbId: svc.id,
        notes,
      };
    });

    // Sort: overdue → pending → unassigned → completed
    const ORDER = { overdue: 0, pending: 1, unassigned: 2, completed: 3 };
    services.sort((a, b) => ORDER[a.status] - ORDER[b.status]);

    const summary = {
      total: services.length,
      completed: services.filter(s => s.status === 'completed').length,
      pending: services.filter(s => s.status === 'pending').length,
      overdue: services.filter(s => s.status === 'overdue').length,
      unassigned: services.filter(s => s.status === 'unassigned').length,
    };

    return {
      date: todayISO,
      dayOfWeek: todayDayName,
      weekStartSunday,
      services,
      summary,
    };
  },
});
