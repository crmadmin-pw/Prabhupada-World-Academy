import { z } from 'zod';
import { createEndpoint, Services, ServiceAllocations, Users, FolkResidencies } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get the service allocation board for a week',
  authenticated: true,
  inputSchema: z.object({
    weekStartDate: z.string(),
    residencyId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const { weekStartDate, residencyId } = input;
    // Service week: Sunday → Saturday
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayOfWeekMap: Record<string, string> = {
      Sunday: 'sun', Monday: 'mon', Tuesday: 'tue', Wednesday: 'wed',
      Thursday: 'thu', Friday: 'fri', Saturday: 'sat',
    };
    // Offset from Sunday (week start)
    const dayIndexMap: Record<string, number> = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };

    // Figure out which days have already passed
    const weekStartMs = new Date(weekStartDate + 'T00:00:00').getTime();
    const nowMs = Date.now();

    // Resolve custom residencyId (e.g. "RES-001") to the database UUID
    let residencyDbId: string | undefined;
    if (residencyId) {
      const residencyRecord = await FolkResidencies.findOne({
        filters: { residencyId },
        fields: ['id'],
      });
      residencyDbId = residencyRecord?.id;
    }

    // Get active services
    const { records: allServices } = await Services.findAll({ filters: { isActive: true }, limit: 200 });
    const relevantServices = allServices.filter(s => {
      if (s.serviceScope === 'General') return true;
      // Include any service linked to this residency regardless of whether serviceScope is set
      const svcResidency = Array.isArray(s.residency) ? s.residency[0] : s.residency;
      if (residencyDbId && svcResidency === residencyDbId) return true;
      return false;
    }).sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));

    if (relevantServices.length === 0) {
      return { services: [], days, grid: {}, summary: { total: 0, completed: 0, overdue: 0, pending: 0 } };
    }

    // Get allocations for this week
    const allocRes = await ServiceAllocations.findAll({
      filters: { weekDate: weekStartDate },
      limit: 500,
      fields: ['id', 'allocationId', 'service', 'user', 'backupUser', 'isBackup', 'dayOfWeek', 'status', 'completedAt'],
    });
    const allocations = allocRes.records;

    // Get user info for all allocated + backup users
    const primaryUserIds = [...new Set(allocations.map(a => Array.isArray(a.user) ? a.user[0] : a.user).filter(Boolean))] as string[];
    const backupUserIds = [...new Set(allocations.map(a => Array.isArray(a.backupUser) ? a.backupUser[0] : a.backupUser).filter(Boolean))] as string[];
    const allUserIds = [...new Set([...primaryUserIds, ...backupUserIds])];

    const userMap: Record<string, { userId: string; name: string }> = {};
    if (allUserIds.length > 0) {
      const usersRes = await Users.findAll({ filters: { id: { in: allUserIds } }, fields: ['id', 'userId', 'fullName'], limit: 200 });
      usersRes.records.forEach(u => { userMap[u.id] = { userId: u.userId || u.id, name: u.fullName || '' }; });
    }

    // Build grid: serviceId -> dayKey -> cell[]
    const grid: Record<string, Record<string, any[]>> = {};
    let completed = 0, overdue = 0, pending = 0;

    for (const svc of relevantServices) {
      grid[svc.id] = {};
      days.forEach(d => { grid[svc.id][d] = []; });
    }

    for (const a of allocations) {
      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      if (!svcId || !grid[svcId]) continue;
      const dayKey = dayOfWeekMap[a.dayOfWeek || ''] || '';
      if (!dayKey) continue;

      const userId = Array.isArray(a.user) ? a.user[0] : a.user;
      const backupUserId = Array.isArray(a.backupUser) ? a.backupUser[0] : a.backupUser;
      const userInfo = userMap[userId || ''];
      const backupInfo = backupUserId ? userMap[backupUserId] : undefined;

      // Determine isOverdue: day has passed and status is still Scheduled
      const dayIdx = dayIndexMap[dayKey] ?? -1;
      const dayMs = weekStartMs + dayIdx * 86400000;
      const rawStatus = (a.status || 'Scheduled');
      const status = rawStatus.toLowerCase();
      const isOverdue = dayMs < nowMs && status === 'scheduled';

      if (status === 'done') completed++;
      else if (isOverdue || status === 'overdue') overdue++;
      else pending++;

      grid[svcId][dayKey].push({
        allocationId: a.allocationId || a.id,
        recordId: a.id,
        userId: userInfo?.userId || userId || '',
        userDbId: userId || '',
        userName: userInfo?.name || '',
        backupUserId: backupInfo?.userId || backupUserId || null,
        backupUserDbId: backupUserId || null,
        backupUserName: backupInfo?.name || null,
        isBackup: a.isBackup || false,
        status: isOverdue && status === 'scheduled' ? 'overdue' : status,
        isOverdue,
      });
    }

    return {
      services: relevantServices.map(s => ({
        serviceId: s.id,
        serviceName: s.serviceName || '',
        timeSlot: s.timeSlot || '',
        category: s.category || '',
        peopleNeeded: s.peopleNeeded || 1,
      })),
      days,
      grid,
      summary: { total: allocations.length, completed, overdue, pending },
    };
  },
});
