import { z } from 'zod';
import { createEndpoint } from '@/lib/backend-sdk';
import { loadAshrayaConfig } from '@/lib/pwTargetResolver';

export default createEndpoint({
  description: 'Ashraya-level Prabhupada World sadhana targets and the submission deadline',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async () => loadAshrayaConfig(),
});
