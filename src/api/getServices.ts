import { z } from 'zod';
import { createEndpoint, Services } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get services list',
  authenticated: true,
  inputSchema: z.object({
    scope: z.string().optional(),
    residencyId: z.string().optional(),
    includeInactive: z.boolean().optional(),
    serviceType: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const includeInactive = input.includeInactive ?? false;
    const filters = includeInactive ? {} : { isActive: true };
    const { records } = await Services.findAll({ filters, limit: 200 });

    const filtered = records.filter(s => {
      if (input.scope === 'residency' && s.serviceScope !== 'Residency') return false;
      if (input.residencyId && s.serviceScope === 'Residency') {
        const r = Array.isArray(s.residency) ? s.residency[0] : s.residency;
        return r === input.residencyId;
      }
      return true;
    });

    return {
      services: filtered.map(s => ({
        serviceId: s.id,
        serviceName: s.serviceName || '',
        timeSlot: s.timeSlot || '',
        category: s.category || '',
        serviceType: s.serviceType || 'Weekly',
        peopleNeeded: s.peopleNeeded || 1,
        description: s.description || '',
        serviceScope: s.serviceScope || 'General',
        isActive: s.isActive ?? true,
        sortOrder: s.sortOrder || 99,
        dueOffsetMinutes: s.dueOffsetMinutes ?? 30,
        durationMinutes: s.durationMinutes ?? 30,
        requiredSkillsJson: s.requiredSkillsJson || '[]',
        customFieldsJson: (s as any).customFieldsJson || '',
        id: s.id,
      })),
    };
  },
});
