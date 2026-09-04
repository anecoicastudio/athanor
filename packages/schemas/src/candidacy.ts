import { z } from 'zod';
import { projectCategorySchema } from './project.ts';

/**
 * dream_candidacies.status — service-role/ethics drive transitions; client only ever 'submitted'.
 * 'voided' (#216, D33/D34) is the terminal state for candidacies of a voided cycle — not a
 * rejection (rejection_reasons stays NULL) and never on the ballot (is_on_ballot() allowlist).
 */
export const candidacyStatusSchema = z.enum([
  'submitted',
  'screening',
  'shortlisted',
  'rejected',
  'winner',
  'voided',
]);
export type CandidacyStatus = z.infer<typeof candidacyStatusSchema>;

/**
 * #218/D5 — the published screening criteria codes (screening_criteria.code, seeded in
 * 20260815164809). Objective only, no Aura criterion, by decision. i18n renders each as
 * fund.screening.criteria.<code>.t/.d.
 */
export const screeningCriterionCodeSchema = z.enum([
  'identity_verified',
  'proposal_complete',
  'no_moderation_sanction',
  'plan_coherent',
]);
export type ScreeningCriterionCode = z.infer<typeof screeningCriterionCodeSchema>;

/** Full read-model of a fund application (backend 06 §2.4). */
export const dreamCandidacySchema = z.object({
  id: z.string().uuid(),
  edition_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  story: z.string().min(1).max(4000),
  goal: z.string().min(1).max(2000),
  impact: z.string().min(1).max(2000),
  video_url: z.string().min(1), // Storage path in `candidacy-videos` — NOT a URL
  thumb_path: z.string().nullable(), // Poster frame beside it, `{uid}/{id}-thumb.jpg`; null = none
  plan: z.string().min(1).max(4000),
  status: candidacyStatusSchema,
  city: z.string().nullable(),
  // #225 — the project_category enum as-is (D43): a coarse ballot filter, DB CHECK-bound.
  category: projectCategorySchema.nullable(),
  // #225 (FUND-09/D10-D11) — budget the dream needs + the minimum viable amount beside it.
  // min_viable_cents is BALLOT INFORMATION, never the shortfall gate (that is FUND-42).
  budget_cents: z.number().int().positive(),
  min_viable_cents: z.number().int().positive(),
  // #225 (FUND-10/D13) — curated keys from @athanor/core SKILLS; the shape caps mirror the
  // DB CHECK, vocabulary membership is the app boundary's job (the profiles.skills pattern).
  skills_needed: z.array(z.string().min(1)).max(10),
  // #225 (FUND-50/D12) — optional link to the author's own personal dream.
  dream_id: z.string().uuid().nullable(),
  // #218 (FUND-52/D6) — screening_criteria codes the candidacy failed; present exactly
  // when status='rejected' (DB CHECK), cleared by the reopen (appeal) transition.
  rejection_reasons: z.array(screeningCriterionCodeSchema).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type DreamCandidacy = z.infer<typeof dreamCandidacySchema>;

/** Author-supplied fields on submit; the api injects id, profile_id, status='submitted'. */
export const candidacyInsertSchema = dreamCandidacySchema
  .pick({
    edition_id: true,
    story: true,
    goal: true,
    impact: true,
    video_url: true,
    plan: true,
    budget_cents: true,
    min_viable_cents: true,
  })
  .extend({
    // Defaulted rather than required: poster extraction is best-effort and must never be able
    // to block a submission the member already waited on a video upload for.
    thumb_path: z.string().nullable().default(null),
    // Defaulted rather than required: the wizard steps for these are #226's; a submit that
    // says nothing about them is a first-class state.
    skills_needed: z.array(z.string().min(1)).max(10).default([]),
    category: projectCategorySchema.nullable().default(null),
    dream_id: z.string().uuid().nullable().default(null),
  })
  // Mirrors the DB CHECK: a minimum above the budget is not a minimum.
  .refine((v) => v.min_viable_cents <= v.budget_cents, {
    message: 'min_viable_cents must not exceed budget_cents',
    path: ['min_viable_cents'],
  });
export type CandidacyInsert = z.infer<typeof candidacyInsertSchema>;

/**
 * Same-cycle edit while status='submitted' (#226) — RLS
 * (dream_candidacies_update_own_submitted) pins the row to the author, the status to
 * 'submitted' (USING + WITH CHECK) and dream_id to an own dream. edition_id, profile_id
 * and status are deliberately absent: an edit never re-targets a row.
 */
export const candidacyUpdateSchema = dreamCandidacySchema
  .pick({
    story: true,
    goal: true,
    impact: true,
    video_url: true,
    thumb_path: true,
    plan: true,
    budget_cents: true,
    min_viable_cents: true,
    skills_needed: true,
    category: true,
    dream_id: true,
  })
  .partial()
  // Mirrors the DB CHECK when both numbers travel together; a lone update of either
  // still hits the CHECK server-side against the stored counterpart.
  .refine(
    (v) =>
      v.budget_cents === undefined ||
      v.min_viable_cents === undefined ||
      v.min_viable_cents <= v.budget_cents,
    { message: 'min_viable_cents must not exceed budget_cents', path: ['min_viable_cents'] },
  );
export type CandidacyUpdate = z.infer<typeof candidacyUpdateSchema>;

/**
 * The `fund_candidate_cards` view read-model — candidacy + author handle + dream-text title,
 * plus (#227) the ballot numbers and the linked dream's confirmed history.
 *
 * The candidacy half is DERIVED from `dreamCandidacySchema` rather than re-declared: the view
 * passes those five columns through unchanged, and two hand-kept copies of a shape drift the
 * moment one of them gains a field.
 */
export const candidateCardSchema = dreamCandidacySchema
  .pick({
    edition_id: true,
    profile_id: true,
    city: true,
    category: true,
    status: true,
    video_url: true,
    thumb_path: true,
    created_at: true,
    // #227 — what the vote is about: the budget the dream needs and the minimum viable
    // amount beside it. min_viable_cents is BALLOT INFORMATION (D11), never the shortfall
    // gate; the copy that renders it must keep saying so.
    budget_cents: true,
    min_viable_cents: true,
    skills_needed: true,
    dream_id: true,
  })
  .extend({
    candidacy_id: z.string().uuid(),
    handle: z.string().nullable(),
    title: z.string().nullable(), // author's active dream text

    /**
     * #227/FUND-50 — the linked dream's CONFIRMED history: milestones done, helps completed.
     * Aggregates from `athanor.dream_confirmed_counts`, never rows (milestone_helps is
     * party-scoped and a voter is neither party).
     *
     * `null` and `0` are different answers and both are load-bearing: null means there is no
     * dream to speak for (none linked, or the linked one was soft-deleted), 0 means a live
     * linked dream with nothing confirmed yet. Only confirmed states count — an offered help
     * is a promise, and a promise a candidate could ask friends for is exactly the vanity
     * number rule #3 keeps off this card.
     */
    dream_milestones_done: z.number().int().nonnegative().nullable(),
    dream_helps_confirmed: z.number().int().nonnegative().nullable(),
  });
export type CandidateCard = z.infer<typeof candidateCardSchema>;
