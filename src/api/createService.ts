import { z } from 'zod';
import { createEndpoint, Services, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Create a new service',
  authenticated: true,
  inputSchema: z.object({
    serviceName: z.string(),
    description: z.string().optional(),
    timeSlot: z.string().optional(),
    category: z.string().optional(),
    serviceType: z.string().optional(),
    serviceScope: z.string().optional(),
    peopleNeeded: z.number().optional(),
    sortOrder: z.number().optional(),
    dueOffsetMinutes: z.number().optional(),
    durationMinutes: z.number().optional(),
    requiredSkillsJson: z.string().optional(),
    residencyId: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    if (!input.serviceName) throw new ZiteError({ code: 'BAD_REQUEST', message: 'serviceName is required' });

    // Resolve custom residency ID (e.g. "RES-001") to UUID for the linked record field
    let residencyUuid: string | undefined;
    if (input.residencyId) {
      const residency = await FolkResidencies.findOne({ filters: { residencyId: input.residencyId } });
      if (residency) {
        residencyUuid = residency.id;
      }
      // If not found by custom ID, try treating it as a UUID directly
      if (!residencyUuid) {
        const byUuid = await FolkResidencies.findOne({ id: input.residencyId });
        if (byUuid) residencyUuid = byUuid.id;
      }
    }

    const record = await Services.create({
      record: {
        serviceName: input.serviceName,
        description: input.description || '',
        timeSlot: input.timeSlot || '',
        category: (input.category as any) || undefined,
        serviceType: (input.serviceType as any) || 'Weekly',
        serviceScope: (input.serviceScope as any) || undefined,
        peopleNeeded: input.peopleNeeded || 1,
        sortOrder: input.sortOrder ?? 99,
        dueOffsetMinutes: input.dueOffsetMinutes ?? 30,
        durationMinutes: input.durationMinutes ?? 30,
        requiredSkillsJson: input.requiredSkillsJson || '[]',
        residency: residencyUuid || undefined,
        isActive: input.isActive ?? true,
      },
    });

    return { success: true, serviceId: record.id };
  },
});
