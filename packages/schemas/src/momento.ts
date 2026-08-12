import { z } from 'zod';
import { avatarPathSchema, displayNameSchema } from './profile';

// Mirrors supabase/migrations/<ts>_momento_proposals.sql (schemas mirror migrations).
// `affinity` is intentionally absent — the column-level grant never sends it to the client.
export const momentoStatus = z.enum(['pending', 'accepted', 'passed']);
export type MomentoStatus = z.infer<typeof momentoStatus>;

/**
 * The wire shape of the deck select, parsed at the boundary. `candidate` is an aliased embed
 * carrying a nested `dreams` embed, which supabase-js infers as an array and cannot type
 * through the alias — hence a schema rather than a cast. `candidate` is nullable because the
 * profiles SELECT policy (not_blocked) filters the embed to null when either side blocks
 * after the proposal row is written; hiding the dream only empties the nested `dreams`.
 * `reasons` mirrors the column: text[] not null default '{}'.
 */
export const momentoDeckRow = z.object({
  id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  reasons: z.array(z.string()),
  status: momentoStatus,
  candidate: z
    .object({
      handle: z.string().nullable(),
      display_name: displayNameSchema.nullable(),
      avatar_path: avatarPathSchema.nullable(),
      dreams: z.array(z.object({ text: z.string() })).nullish(),
    })
    .nullable(),
});
export type MomentoDeckRow = z.infer<typeof momentoDeckRow>;

// The deck-card read model (proposal joined to the peer profile + active dream quote).
export const momentoDeckCard = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  handle: z.string().nullable(),
  displayName: displayNameSchema.nullable(),
  avatarPath: avatarPathSchema.nullable(),
  reasons: z.array(z.string()),
  dreamText: z.string().nullable(),
  status: momentoStatus,
});
export type MomentoDeckCard = z.infer<typeof momentoDeckCard>;

// «Ti potrebbe interessare» curated-lite row (one peer).
export const momentoSuggestion = z.object({
  candidateId: z.string().uuid(),
  handle: z.string().nullable(),
  displayName: displayNameSchema.nullable(),
  avatarPath: avatarPathSchema.nullable(),
  dreamText: z.string().nullable(),
});
export type MomentoSuggestion = z.infer<typeof momentoSuggestion>;

// accept_momento RPC return shape.
export const acceptMomentResult = z.object({
  matched: z.boolean(),
  conversationId: z.string().uuid().nullable(),
});
export type AcceptMomentResult = z.infer<typeof acceptMomentResult>;
