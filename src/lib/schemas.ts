// ══════════════════════════════════════════════════════════════════════════════
// Shared Zod schemas for API endpoints.
// Import from '@/lib/schemas' in endpoint files to avoid redefining common shapes.
// ══════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

// ─── Common ID schemas ────────────────────────────────────────────────────────

export const UserIdSchema = z.object({ userId: z.string() });
export const GuideIdSchema = z.object({ guideId: z.string() });
export const ResidencyIdSchema = z.object({ residencyId: z.string() });
export const GroupIdSchema = z.object({ groupId: z.string() });
export const EntryIdSchema = z.object({ entryId: z.string() });

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page: z.number().optional(),
  limit: z.number().optional(),
});

// ─── Date range ───────────────────────────────────────────────────────────────

export const DateRangeSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ─── Common output shapes ─────────────────────────────────────────────────────

export const SuccessOutputSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// ─── Week schema (used by sadhana endpoints) ──────────────────────────────────

export const WeekSchema = z.object({
  weekStartDate: z.string().optional(),
});
