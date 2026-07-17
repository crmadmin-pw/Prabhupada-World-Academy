import { z } from 'zod';
import { createEndpoint, AshrayChecklist } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Save the Ashraya checklist for the current user',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    ashrayLevel: z.string(),
    checkedItems: z.array(z.string()),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    const existing = await AshrayChecklist.findOne({ filters: { user: uid } });
    const data = JSON.stringify(input.checkedItems);

    if (existing) {
      await AshrayChecklist.update({ id: existing.id, record: {
        level: input.ashrayLevel,
        checklistDataJson: data,
        completedItems: input.checkedItems.length,
        updatedAt: new Date().toISOString(),
      }});
    } else {
      await AshrayChecklist.create({ record: {
        user: uid,
        level: input.ashrayLevel,
        checklistDataJson: data,
        completedItems: input.checkedItems.length,
        updatedAt: new Date().toISOString(),
      }});
    }
    return { success: true };
  },
});
