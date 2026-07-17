// Re-exports the guide detailed report — BVSL mode uses same endpoint
// The frontend (BvslSadhanaReportPanel) calls getGuideDetailedReport with bvslMode=true
// This stub is kept for backward compat but is not called directly anymore
import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'BVSL sadhana report (deprecated - use getGuideDetailedReport with bvslMode)',
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.any(),
  execute: async () => {
    return { users: [], fieldDefs: [], availableResidencies: [], summary: {} };
  },
});
