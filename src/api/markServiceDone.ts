import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Mark a service allocation as done',
  authenticated: true,
  inputSchema: z.object({ allocationId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    // Find by allocationId field or UUID id
    let record = await ServiceAllocations.findOne({ filters: { allocationId: input.allocationId } });
    if (!record) record = await ServiceAllocations.findOne({ id: input.allocationId });
    if (!record) throw new Error('Allocation not found');

    // Verify ownership
    const userId = Array.isArray(record.user) ? record.user[0] : record.user;
    if (userId !== context.user!.id) throw new Error('Not your allocation');

    // Check if the service has a checklist — if so, verify all items are completed
    const svcId = Array.isArray(record.service) ? record.service[0] : record.service;
    if (svcId) {
      const svcRecord = await Services.findOne({ id: svcId, fields: ['description'] });
      const desc = svcRecord?.description || '';
      let checklistLength = 0;
      try {
        const parsed = JSON.parse(desc);
        if (Array.isArray(parsed) && parsed.length > 0) {
          checklistLength = parsed.length;
        }
      } catch { /* not a checklist */ }

      if (checklistLength > 0) {
        let checkedItems: number[] = [];
        try {
          const notesData = JSON.parse(record.notes || '{}');
          if (Array.isArray(notesData.checkedItems)) checkedItems = notesData.checkedItems;
        } catch { /* no notes */ }

        if (checkedItems.length < checklistLength) {
          throw new Error('Please complete all checklist items first');
        }
      }
    }

    await ServiceAllocations.update({ id: record.id, record: { status: 'Done', completedAt: new Date().toISOString() } });
    return { success: true };
  },
});
