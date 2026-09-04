import { z } from 'zod';
import { avatarPathSchema, displayNameSchema } from './profile.ts';

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
 * owner keeps it visible. `mutualActivity` carries TITLES of events both members were checked
 * in at (#361) — verified co-attendance; event ids never reach the client, and the caller only
 * ever sees rooms they were in themselves. `profession` carries the two profession KEYS
 * (`tag.profession.*`), the reader's craft first, when the pair complements per
 * `PROFESSION_COMPLEMENTS` (#361). `newDream` is the dream-recency fallback and claims
 * no overlap at all, so it carries no tags.
 */
export const momentoReasonKind = z.enum([
  'shared',
  'seeking',
  'offering',
  'skills',
  'city',
  'mutualActivity',
  'profession',
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
  mutual_activity: z.array(z.string()),
  profession_pair: z.array(z.string()),
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

/**
 * One «Ti potrebbe interessare» row — mirrors `get_momenti_suggestion()` (migration
 * <ts>_momento_suggestions.sql), which serves up to three of these.
 *
 * `reasons` carries KINDS and no tags, unlike `momentoReason`: the row has one line of chrome
 * for a chip, so it names the overlap («Sapete fare») without listing it. They arrive already
 * ranked by `rankReasons`, so `reasons[0]` is the chip. `newDream` is what the cold-start arm
 * returns — a member no nightly run has reached yet — and it never travels with another kind.
 *
 * `affinity` is absent for the reason it is absent from `momentoDeckRow`: the column carries no
 * client grant and no surface renders a score (rule 3).
 */
export const momentoSuggestion = z.object({
  candidateId: z.string().uuid(),
  handle: z.string().nullable(),
  displayName: displayNameSchema.nullable(),
  avatarPath: avatarPathSchema.nullable(),
  dreamText: z.string().nullable(),
  reasons: z.array(momentoReasonKind).min(1),
});
export type MomentoSuggestion = z.infer<typeof momentoSuggestion>;

// accept_momento RPC return shape.
export const acceptMomentResult = z.object({
  matched: z.boolean(),
  conversationId: z.string().uuid().nullable(),
});
export type AcceptMomentResult = z.infer<typeof acceptMomentResult>;
