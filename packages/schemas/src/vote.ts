import { z } from 'zod';

/** Own-row read of a cast vote (backend 06 §2.5). weight = server-written Aura snapshot. */
export const candidacyVoteSchema = z.object({
  id: z.string().uuid(),
  edition_id: z.string().uuid(),
  candidacy_id: z.string().uuid(),
  voter_id: z.string().uuid(),
  weight: z.coerce.number().nonnegative(), // numeric(6,3) arrives as a string
  created_at: z.string(),
});
export type CandidacyVote = z.infer<typeof candidacyVoteSchema>;

/** One row of the public `candidacy_tally(edition)` aggregate — never includes voter_id. */
export const candidacyTallyRowSchema = z.object({
  candidacy_id: z.string().uuid(),
  vote_count: z.coerce.number().int().nonnegative(), // bigint → string from PostgREST
  weighted_total: z.coerce.number().nonnegative(), // numeric → string
});
export type CandidacyTallyRow = z.infer<typeof candidacyTallyRowSchema>;
