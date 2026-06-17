import { z } from 'zod';

export const fundPhaseSchema = z.enum(['community', 'reputation', 'ethics', 'event', 'closed']);
export type FundPhase = z.infer<typeof fundPhaseSchema>;

/** Public read-model of one annual fund edition (backend 06 §2.1). */
export const fundEditionSchema = z.object({
  id: z.string().uuid(),
  year: z.number().int(),
  target_at: z.string(), // ISO timestamptz — the server-authoritative countdown clock
  goal_cents: z.number().int().positive(),
  phase: fundPhaseSchema,
  candidacy_window_open: z.boolean(),
  contributions_enabled: z.boolean(),
  winner_candidacy_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FundEdition = z.infer<typeof fundEditionSchema>;

/** Public read-model of the live-ticker aggregate cache (backend 06 §2.3). */
export const fundAggregateSchema = z.object({
  edition_id: z.string().uuid(),
  raised_cents: z.number().int().nonnegative(),
  contributor_count: z.number().int().nonnegative(),
  updated_at: z.string(),
});
export type FundAggregate = z.infer<typeof fundAggregateSchema>;
