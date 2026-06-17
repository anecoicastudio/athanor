import { z } from 'zod';

/** The Six Stars, canonical PRD §4.10 order. Display names live in @athanor/i18n
 *  (star.*); these stable keys are the validation + storage identifiers. */
export const STAR_KEYS = [
  'visionario',
  'mentor',
  'collaboratore',
  'creatore',
  'innovatore',
  'ambasciatore',
] as const;

export const starKeySchema = z.enum(STAR_KEYS);
export type StarKey = z.infer<typeof starKeySchema>;

/** A read-only Aura snapshot (PRD §1.1). M1 reads a coalesced zero-snapshot;
 *  the M6 score-engine fills real values — the shape never changes. */
export const auraSnapshotSchema = z.object({
  score: z.number().int().min(0),
  stars: z.object({
    visionario: z.boolean(),
    mentor: z.boolean(),
    collaboratore: z.boolean(),
    creatore: z.boolean(),
    innovatore: z.boolean(),
    ambasciatore: z.boolean(),
  }),
});
export type AuraSnapshot = z.infer<typeof auraSnapshotSchema>;

/** The never-null default (backend 07 §2.2a): score 0, all six stars unlit. */
export const ZERO_AURA_SNAPSHOT: AuraSnapshot = {
  score: 0,
  stars: {
    visionario: false,
    mentor: false,
    collaboratore: false,
    creatore: false,
    innovatore: false,
    ambasciatore: false,
  },
};

/** The six display buckets (backend 07 §2.2). */
export const breakdownSchema = z.object({
  contributi: z.number().int(),
  eventi: z.number().int(),
  collaborazioni: z.number().int(),
  valore: z.number().int(),
  recensioni: z.number().int(),
  affidabilita: z.number().int(),
});
export type Breakdown = z.infer<typeof breakdownSchema>;

/** A computed Aura snapshot row (world-readable; engine-written). */
export const auraScoreSchema = z.object({
  profileId: z.string().uuid(),
  score: z.number().int().min(0).max(1000),
  breakdown: breakdownSchema,
  peakScore: z.number().int().min(0).max(1000),
  lastQualifyingActionAt: z.string().datetime().nullable(),
  computedAt: z.string().datetime(),
});
export type AuraScore = z.infer<typeof auraScoreSchema>;

/** The nine ledger types (eight signed actions + decay). */
export const auraEventTypeSchema = z.enum([
  'identity_verified',
  'event_attended',
  'event_organized',
  'momento_conversation',
  'milestone_help',
  'own_milestone',
  'post_starred',
  'report_upheld',
  'decay',
]);
export type AuraEventType = z.infer<typeof auraEventTypeSchema>;

/** An append-only ledger row (owner-read). */
export const auraEventSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  type: auraEventTypeSchema,
  points: z.number().int(),
  refId: z.string().uuid().nullable(),
  reason: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type AuraEvent = z.infer<typeof auraEventSchema>;

/** A six-star grant row (earned-only for others via RLS). */
export const starSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  starId: starKeySchema,
  grantedAt: z.string().datetime().nullable(),
  progress: z.object({ done: z.number().int(), total: z.number().int(), unit: z.string() }),
});
export type Star = z.infer<typeof starSchema>;

/**
 * The shaped Aura celebration broadcast payload (backend 09 §6.1). Emitted by the
 * score-engine onto the owner-private `aura:{profileId}` Realtime topic; the app
 * validates it before firing the level-up overlay / star flash. All fields optional —
 * the engine sends only what changed. Never written by a client (rule #1).
 */
export const auraCelebrationPayload = z.object({
  tier_up: z.string().nullish(),
  new_stars: z.array(z.string()).nullish(),
  score: z.number().int().optional(),
});

export type AuraCelebrationPayload = z.infer<typeof auraCelebrationPayload>;
