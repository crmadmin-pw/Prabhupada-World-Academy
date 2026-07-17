import { z } from 'zod';
import { createEndpoint, Services, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Update a service',
  authenticated: true,
  inputSchema: z.object({
    serviceId: z.string(),
    serviceName: z.string().optional(),
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
    isActive: z.boolean().optional(),
    rowId: z.union([z.string(), z.number()]).optional(),
    customFieldsJson: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const id = input.rowId ? String(input.rowId) : input.serviceId;
    const service = await Services.findOne({ id });
    if (!service) throw new ZiteError({ code: 'NOT_FOUND', message: 'Service not found' });

    const updates: any = {};
    if (input.serviceName !== undefined) updates.serviceName = input.serviceName;
    if (input.description !== undefined) updates.description = input.description;
    if (input.timeSlot !== undefined) updates.timeSlot = input.timeSlot;
    if (input.category !== undefined) updates.category = input.category;
    if (input.serviceType !== undefined) updates.serviceType = input.serviceType;
    if (input.serviceScope !== undefined) updates.serviceScope = input.serviceScope;
    if (input.peopleNeeded !== undefined) updates.peopleNeeded = input.peopleNeeded;
    if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
    if (input.dueOffsetMinutes !== undefined) updates.dueOffsetMinutes = input.dueOffsetMinutes;
    if (input.durationMinutes !== undefined) updates.durationMinutes = input.durationMinutes;
    if (input.requiredSkillsJson !== undefined) updates.requiredSkillsJson = input.requiredSkillsJson;
    if (input.isActive !== undefined) updates.isActive = input.isActive;
    if (input.customFieldsJson !== undefined) updates.customFieldsJson = input.customFieldsJson;

    await Services.update({ id, record: updates });

    return { success: true };
  },
});
