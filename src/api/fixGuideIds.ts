import { z } from 'zod';
import { createEndpoint, Users, Guides, ZiteError } from 'zite-integrations-backend-sdk';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default createEndpoint({
  description: 'Migration: fix users with broken guide IDs (non-UUID values like "guide_XXXX") by matching them to real Guides records',
  authenticated: true,
  inputSchema: z.object({ dryRun: z.boolean().optional() }),
  outputSchema: z.object({
    scanned: z.number(),
    fixed: z.number(),
    skipped: z.number(),
    errors: z.array(z.string()),
    dryRun: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    if (context.user!.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }
    const dryRun = input.dryRun !== false; // default dry run for safety

    // Fetch all guides — build maps: UUID set + guideId→UUID + email→UUID
    const { records: allGuides } = await Guides.findAll({ fields: ['id', 'guideId', 'email'], limit: 500 });
    const guideUUIDSet = new Set(allGuides.map(g => g.id));
    const guideIdToUUID = new Map<string, string>();
    const guideEmailToUUID = new Map<string, string>();
    for (const g of allGuides) {
      if (g.guideId) guideIdToUUID.set(g.guideId, g.id);
      if (g.email) guideEmailToUUID.set(g.email.toLowerCase(), g.id);
    }

    // Fetch all users with guide field
    let allUsers: any[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await Users.findAll({
        fields: ['id', 'guide', 'email'],
        limit: 2000,
        offset,
      });
      allUsers = allUsers.concat(records);
      if (!hasMore) break;
      offset += 2000;
    }

    let fixed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const user of allUsers) {
      const rawGuide = Array.isArray(user.guide) ? user.guide[0] : user.guide;
      if (!rawGuide) { skipped++; continue; }

      // If already a valid UUID pointing to a known guide, skip
      if (UUID_REGEX.test(rawGuide) && guideUUIDSet.has(rawGuide)) { skipped++; continue; }

      // Try to find the correct guide UUID
      let correctUUID: string | undefined;

      // Match by guideId field (e.g., "guide_849f0244", "GUIDE-001")
      correctUUID = guideIdToUUID.get(rawGuide);

      // If still not found and rawGuide looks like an email
      if (!correctUUID && rawGuide.includes('@')) {
        correctUUID = guideEmailToUUID.get(rawGuide.toLowerCase());
      }

      if (!correctUUID) {
        errors.push(`User ${user.id}: guide value "${rawGuide}" could not be mapped to any guide`);
        skipped++;
        continue;
      }

      if (!dryRun) {
        try {
          await Users.update({ id: user.id, record: { guide: correctUUID } });
        } catch (e: any) {
          errors.push(`User ${user.id}: update failed — ${e?.message || 'unknown error'}`);
          skipped++;
          continue;
        }
      }
      fixed++;
    }

    return { scanned: allUsers.length, fixed, skipped, errors, dryRun };
  },
});
