import { z } from 'zod';
import { avatarPathSchema, displayNameSchema } from './profile';

// Mirrors supabase/migrations/<ts>_momento_proposals.sql (schemas mirror migrations).
// `affinity` is intentionally absent — the column-level grant never sends it to the client.
export const momentoStatus = z.enum(['pending', 'accepted', 'passed']);
export type MomentoStatus = z.infer<typeof momentoStatus>;

/**
 * One affinity reason, as TERMS rather than prose (#273 D). `tags` are identity tag keys
 * (`tag.identity.*` in @athanor/i18n) in the tag kinds — `seeking` carries the identities the
 * candidate holds that answer what you seek, `offering` the identities of YOURS that answer
 * what they seek. `skills` carries skill keys (`tag.skill.*`, #123). `city` carries the
 * candidate's city DISPLAY NAME at most — never a geohash or coordinate — and only while the
 * owner keeps it visible. `newDream` is the dream-recency fallback and claims no overlap at
 * all, so it carries no tags.
 */
export const momentoReasonKind = z.enum([
  'shared',
  'seeking',
  'offering',
  'skills',
  'city',
  'newDream',
]);
export type MomentoReasonKind = z.infer<typeof momentoReasonKind>;

export const momentoReason = z.object({
  kind: momentoReasonKind,
  tags: z.array(z.string()),
});
export type MomentoReason = z.infer<typeof momentoReason>;

/**
 * The wire shape of `get_momenti_deck()` (migration <ts>_momenti_affinity_and_deck.sql),
 * parsed at the boundary. The deck stopped being a table select in #273: the terms are
 * recomputed and re-masked server-side on every read, so nothing here is a snapshot.
 *
 * `dream_text` is NOT nullable — the RPC inner-joins the candidate's newest active dream and
 * drops the row when there is none. `affinity` is absent, as it is from the column grant: the
 * RPC returns `reason_kind` instead (rule #1).
 */
export const momentoDeckRow = z.object({
  proposal_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  handle: z.string().nullable(),
  display_name: displayNameSchema.nullable(),
  avatar_path: avatarPathSchema.nullable(),
  dream_text: z.string(),
  reason_kind: z.enum(['affinity', 'new_dream']),
  shared: z.array(z.string()),
  seek_hit: z.array(z.string()),
  offer_hit: z.array(z.string()),
  skills_shared: z.array(z.string()),
  city_near: z.array(z.string()),
});
export type MomentoDeckRow = z.infer<typeof momentoDeckRow>;

// The deck-card read model (proposal + the peer's identity, dream quote and live reasons).
export const momentoDeckCard = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  handle: z.string().nullable(),
  displayName: displayNameSchema.nullable(),
  avatarPath: avatarPathSchema.nullable(),
  reasons: z.array(momentoReason),
  dreamText: z.string(),
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
