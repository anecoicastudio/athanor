import { z } from 'zod';

/** The Six Stars, canonical PRD §4.10 order. Display names live in @auria/i18n
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
  stars: z.record(starKeySchema, z.boolean()),
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
