import { z } from 'zod';
import { createEndpoint, Config, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get TagMango configuration (Super Guide only)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    apiKey: z.string(),
    apiUrl: z.string(),
    courseConfig: z.record(z.string(), z.record(z.string(), z.string())),
    residencies: z.array(z.object({ id: z.string(), name: z.string() })),
    envKeyConfigured: z.boolean(),
  }),
  execute: async ({ context }) => {
    if (context.user.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }

    const [configResult, residencyResult] = await Promise.all([
      Config.findAll({ filters: { configKey: { in: ['tagmango_api_key', 'tagmango_api_url', 'course_config'] } }, limit: 50 }),
      FolkResidencies.findAll({ filters: { isActive: true }, limit: 200, fields: ['residencyName'] }),
    ]);

    const map = new Map(configResult.records.map(r => [r.configKey, r.configValue || '']));

    let courseConfig: Record<string, Record<string, string>> = {};
    const courseConfigRaw = map.get('course_config');
    if (courseConfigRaw) {
      try { courseConfig = JSON.parse(courseConfigRaw); } catch { /* ignore */ }
    }

    const residencies = residencyResult.records
      .filter(r => r.residencyName)
      .map(r => ({ id: r.id, name: r.residencyName! }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      apiKey: map.get('tagmango_api_key') || '',
      apiUrl: map.get('tagmango_api_url') || 'https://api-prod-new.tagmango.com/integration/action/migrate-user',
      courseConfig,
      residencies,
      envKeyConfigured: !!process.env.ZITE_TAGMANGO_API_KEY,
    };
  },
});
