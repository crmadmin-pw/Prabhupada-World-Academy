import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zite-integrations-backend-sdk';
import { resolveApiKey, resolveApiUrl } from '../lib/tagMangoEnroll';

export default createEndpoint({
  description: 'Test TagMango API connection using the actual migrate-user endpoint',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ success: z.boolean(), message: z.string() }),
  execute: async ({ context }) => {
    if (context.user.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }

    const apiKey = await resolveApiKey();
    if (!apiKey) {
      return { success: false, message: 'No API key configured' };
    }

    // Send GET request to test API connection
    const url = new URL('https://api-prod-new.tagmango.com/api/v1/external/mangos');
    url.searchParams.append('limit', '10');
    url.searchParams.append('page', '1');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'x-whitelabel-host': 'learn.prabhupadaworld.com',
        'Content-Type': 'application/json',
      },
    });

    const body = await response.text();
    const lower = body.toLowerCase();

    // If the body mentions "api key not found" — the key is invalid/missing
    if (lower.includes('api key not found') || lower.includes('invalid api key') || lower.includes('unauthorized')) {
      return { success: false, message: 'Invalid API key — authentication failed' };
    }

    // 200/201 = key works and request succeeded
    if (response.ok) {
      return { success: true, message: 'API key is valid — connection successful' };
    }

    // 400/422 with other errors = key is valid, request was just bad data (expected)
    if (response.status === 400 || response.status === 422) {
      return { success: true, message: 'API key is valid — connection successful' };
    }

    // 401/403 = auth failure
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: 'Invalid API key — authentication failed' };
    }

    return { success: false, message: `Unexpected response (HTTP ${response.status}): ${body.slice(0, 300)}` };
  },
});
