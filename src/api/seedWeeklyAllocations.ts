import { z } from 'zod';
import { createEndpoint, Services, Users, ServiceAllocations, FolkResidencies } from 'zite-integrations-backend-sdk';

const DOW_MAP: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};
// Service week: Sunday → Saturday
const ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default createEndpoint({
  description: 'Seed a week\'s allocations from a named list — looks up services and residents by name (fuzzy match)',
  authenticated: true,
  inputSchema: z.object({
    weekStartDate: z.string(),
    residencyId: z.string().optional(),
    force: z.boolean().optional(),
    assignments: z.array(z.object({
      serviceName: z.string(),
      assignees: z.array(z.string()),
    })),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isGuide = role === 'Guide' || role === 'Super Guide' || context.user.isServiceAllocator === true;
    if (!isGuide) {
      throw new Error('Only guides or service allocators can seed allocations');
    }

    // Resolve residency DB id
    let residencyDbId: string | undefined;
    if (input.residencyId) {
      const res = await FolkResidencies.findOne({ filters: { residencyId: input.residencyId }, fields: ['id'] });
      if (res) residencyDbId = res.id;
    }

    // If force, delete existing allocations for this week
    if (input.force) {
      const existing = await ServiceAllocations.findAll({ filters: { weekDate: input.weekStartDate }, limit: 500, fields: ['id'] });
      // Parallel deletes — much faster than sequential
      await Promise.all(existing.records.map(rec => ServiceAllocations.delete({ id: rec.id })));
    }

    // Fetch all active services
    const { records: allServices } = await Services.findAll({ filters: { isActive: true }, limit: 200, fields: ['id', 'serviceName'] });

    // Fetch all active residents
    const userFilter: any = { status: 'Active', residencyApproved: true };
    if (residencyDbId) userFilter.residency = residencyDbId;
    const { records: allUsers } = await Users.findAll({ filters: userFilter, limit: 500, fields: ['id', 'fullName'] });

    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

    // Build fuzzy service lookup
    const findService = (name: string) => {
      const n = normalize(name);
      // Exact match first
      let match = allServices.find(s => normalize(s.serviceName || '') === n);
      if (match) return match;
      // Contains match
      match = allServices.find(s => normalize(s.serviceName || '').includes(n) || n.includes(normalize(s.serviceName || '')));
      if (match) return match;
      // Word overlap match (at least 2 words in common)
      const words = n.split(' ').filter(w => w.length > 3);
      match = allServices.find(s => {
        const sw = normalize(s.serviceName || '').split(' ');
        return words.filter(w => sw.includes(w)).length >= 2;
      });
      return match;
    };

    // Build fuzzy user lookup — strip common prefixes like "Bh ", "Bhakta "
    const stripPrefix = (s: string) => s.replace(/^(bh|bhakta|das|prabhu)\s+/i, '').trim();
    const findUser = (name: string) => {
      const n = normalize(stripPrefix(name));
      // Exact on stripped name
      let match = allUsers.find(u => normalize(stripPrefix(u.fullName || '')) === n);
      if (match) return match;
      // Contains
      match = allUsers.find(u => {
        const un = normalize(stripPrefix(u.fullName || ''));
        return un.includes(n) || n.includes(un);
      });
      return match;
    };

    const toCreate: any[] = [];
    const results: any[] = [];
    const notFound: string[] = [];

    for (const assignment of input.assignments) {
      const service = findService(assignment.serviceName);
      if (!service) {
        notFound.push(`SERVICE: "${assignment.serviceName}"`);
        continue;
      }

      const foundUsers: any[] = [];
      const missingUsers: string[] = [];

      for (const assigneeName of assignment.assignees) {
        const user = findUser(assigneeName);
        if (user) {
          foundUsers.push(user);
        } else {
          missingUsers.push(assigneeName);
          notFound.push(`USER: "${assigneeName}" for service "${assignment.serviceName}"`);
        }
      }

      if (foundUsers.length === 0) continue;

      // First person is primary, rest are additional primaries (multi-person services)
      const backupUser = foundUsers.length > 1 ? undefined : undefined; // backup handled separately

      for (const user of foundUsers) {
        for (const day of ALL_DAYS) {
          toCreate.push({
            service: service.id,
            user: user.id,
            weekDate: input.weekStartDate,
            dayOfWeek: DOW_MAP[day],
            status: 'Scheduled',
            isBackup: false,
          });
        }
      }

      results.push({
        service: service.serviceName,
        assignees: foundUsers.map(u => u.fullName),
        missing: missingUsers,
        daysCreated: foundUsers.length * 7,
      });
    }

    // Bulk create in chunks of 100
    let created = 0;
    for (let i = 0; i < toCreate.length; i += 100) {
      const chunk = toCreate.slice(i, i + 100);
      await ServiceAllocations.bulkCreate({ records: chunk });
      created += chunk.length;
    }

    return {
      success: true,
      totalAllocationsCreated: created,
      servicesSeeded: results,
      notFound,
    };
  },
});
