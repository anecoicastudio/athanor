import { z } from 'zod';

// Mirrors supabase/migrations/<ts>_momento_proposals.sql (schemas mirror migrations).
// `affinity` is intentionally absent — the column-level grant never sends it to the client.
export const momentoStatus = z.enum(['pending', 'accepted', 'passed']);
export type MomentoStatus = z.infer<typeof momentoStatus>;

// The deck-card read model (proposal joined to the peer profile + active dream quote).
export const momentoDeckCard = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  handle: z.string().nullable(),
  reasons: z.array(z.string()),
  dreamText: z.string().nullable(),
  status: momentoStatus,
});
export type MomentoDeckCard = z.infer<typeof momentoDeckCard>;

// «Ti potrebbe interessare» curated-lite row (one peer).
export const momentoSuggestion = z.object({
  candidateId: z.string().uuid(),
  handle: z.string().nullable(),
  dreamText: z.string().nullable(),
});
export type MomentoSuggestion = z.infer<typeof momentoSuggestion>;

// accept_momento RPC return shape.
export const acceptMomentResult = z.object({
  matched: z.boolean(),
  conversationId: z.string().uuid().nullable(),
});
export type AcceptMomentResult = z.infer<typeof acceptMomentResult>;
