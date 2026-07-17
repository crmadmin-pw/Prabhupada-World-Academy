import { z } from 'zod';
import { createEndpoint, ZiteError } from 'zite-integrations-backend-sdk';
import { resolveApiKey } from '../lib/tagMangoEnroll';

export default createEndpoint({
  description: 'Register a webhook URL with TagMango for a given event type',
  authenticated: true,
  inputSchema: z.object({
    webhookUrl: z.string().url(),
    eventType: z.enum([
      'order.created.completed',
      'course.completed.10',
      'course.completed.50',
      'course.completed.100',
    ]).default('order.created.completed'),
  }),
  outputSchema: z.object({ success: z.boolean(), message: z.string() }),
  execute: async ({ input, context }) => {
    if (context.user.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }

    const apiKey = await resolveApiKey();
    if (!apiKey) {
      return { success: false, message: 'No API key configured — save API settings first' };
    }

    const response = await fetch('https://api-prod-new.tagmango.com/api/v1/integration/webhook/webhook', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hookUrl: input.webhookUrl,
        event: input.eventType,
      }),
    });

    const body = await response.text();

    if (!response.ok) {
      return { success: false, message: `Registration failed (HTTP ${response.status}): ${body.slice(0, 300)}` };
    }

    return { success: true, message: `Webhook for "${input.eventType}" registered successfully` };
  },
});
