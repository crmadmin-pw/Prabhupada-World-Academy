import { z } from 'zod';
import { createEndpoint, SkillCatalog } from 'zite-integrations-backend-sdk';

const DEFAULT_SKILLS = ['cleaning', 'pujari', 'prasadam', 'tech', 'misc'];

export default createEndpoint({
  description: 'Get all available skills from the catalog (with default seed)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async () => {
    let { records } = await SkillCatalog.findAll({ filters: { isActive: true }, limit: 200, fields: ['id', 'skillName'] });

    // If catalog is empty, seed default skills and refresh
    if (records.length === 0) {
      await Promise.all(DEFAULT_SKILLS.map(name =>
        SkillCatalog.create({ 'Skill Name': name, 'Is Active': true } as any).catch(() => {})
      ));
      const fresh = await SkillCatalog.findAll({ filters: { isActive: true }, limit: 200, fields: ['id', 'skillName'] });
      records = fresh.records;
    }

    return { skills: records.map((s: any) => s.skillName || '').filter(Boolean) };
  },
});
