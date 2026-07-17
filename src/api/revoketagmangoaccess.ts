import { z } from 'zod';
import { createEndpoint, Users, Config, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';
import { resolveApiKey } from '../lib/tagMangoEnroll';

export default createEndpoint({
  description: 'Revoke a user\'s TagMango access via the Revoke User API',
  authenticated: true,
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.object({ success: z.boolean(), message: z.string() }),
  execute: async ({ input, context }) => {
    const role = context.user.role;
    if (role !== 'Guide' && role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only Guides and Super Guides can revoke access' });
    }

    const apiKey = await resolveApiKey();
    if (!apiKey) throw new ZiteError({ code: 'BAD_REQUEST', message: 'TagMango API key not configured' });

    const user = await Users.findOne({
      id: input.userId,
      fields: ['id', 'email', 'ashrayLevel', 'residency', 'enrolledLevel'],
    });
    if (!user) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    // Resolve mangoId from course config
    const level = user.enrolledLevel || user.ashrayLevel;
    let mangoId: string | undefined;

    const configRecord = await Config.findOne({
      filters: { configKey: 'course_config' },
    });
    if (configRecord?.configValue && level) {
      try {
        const courseConfig = JSON.parse(configRecord.configValue) as Record<string, Record<string, string>>;
        // Try to resolve via residency
        let residencyName: string | undefined;
        const rid = Array.isArray(user.residency) ? user.residency[0] : user.residency;
        if (rid) {
          const res = await FolkResidencies.findOne({ id: rid, fields: ['residencyName'] });
          residencyName = res?.residencyName;
        }
        if (residencyName && courseConfig[residencyName]?.[level]) {
          mangoId = courseConfig[residencyName][level];
        } else {
          for (const centerConfig of Object.values(courseConfig)) {
            if (centerConfig[level]) { mangoId = centerConfig[level]; break; }
          }
        }
      } catch { /* ignore */ }
    }

    if (!mangoId) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: `No course mapping found for level "${level}"` });
    }

    const response = await fetch('https://api-prod-new.tagmango.com/integration/action/revoke-user', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, mangoId }),
    });

    const body = await response.text();

    if (!response.ok) {
      const errMsg = `HTTP ${response.status}: ${body.slice(0, 300)}`;
      await Users.update({ id: input.userId, record: { tagMangoError: errMsg } });
      return { success: false, message: errMsg };
    }

    await Users.update({
      id: input.userId,
      record: {
        tagMangoEnrollmentStatus: 'Revoked',
        tagMangoError: '',
      },
    });

    return { success: true, message: 'Access revoked successfully' };
  },
});
