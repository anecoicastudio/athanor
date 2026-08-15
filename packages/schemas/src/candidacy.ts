import { z } from 'zod';
import { projectCategorySchema } from './project';

/** dream_candidacies.status — service-role/ethics drive transitions; client only ever 'submitted'. */
export const candidacyStatusSchema = z.enum([
  'submitted',
  'screening',
  'shortlisted',
  'rejected',
  'winner',
]);
export type CandidacyStatus = z.infer<typeof candidacyStatusSchema>;

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

/** The `fund_candidate_cards` view read-model — candidacy + author handle + dream-text title. */
export const candidateCardSchema = z.object({
  candidacy_id: z.string().uuid(),
  edition_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  handle: z.string().nullable(),
  title: z.string().nullable(), // author's active dream text
  city: z.string().nullable(),
  category: projectCategorySchema.nullable(), // CHECK-bound since #225

  status: candidacyStatusSchema,
  video_url: z.string().min(1),
  thumb_path: z.string().nullable(),
  created_at: z.string(),
});
export type CandidateCard = z.infer<typeof candidateCardSchema>;
