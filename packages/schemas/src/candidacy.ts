import { z } from 'zod';

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
  video_url: z.string().min(1), // Storage path in `candidacy-videos`
  plan: z.string().min(1).max(4000),
  status: candidacyStatusSchema,
  city: z.string().nullable(),
  category: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type DreamCandidacy = z.infer<typeof dreamCandidacySchema>;

/** Author-supplied fields on submit; the api injects id, profile_id, status='submitted'. */
export const candidacyInsertSchema = dreamCandidacySchema.pick({
  edition_id: true,
  story: true,
  goal: true,
  impact: true,
  video_url: true,
  plan: true,
});
export type CandidacyInsert = z.infer<typeof candidacyInsertSchema>;

/** Editable while status='submitted' (the RLS update window). */
export const candidacyUpdateSchema = dreamCandidacySchema
  .pick({ story: true, goal: true, impact: true, video_url: true, plan: true })
  .partial();
export type CandidacyUpdate = z.infer<typeof candidacyUpdateSchema>;

/** The `fund_candidate_cards` view read-model — candidacy + author handle + dream-text title. */
export const candidateCardSchema = z.object({
  candidacy_id: z.string().uuid(),
  edition_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  handle: z.string().nullable(),
  title: z.string().nullable(), // author's active dream text
  city: z.string().nullable(),
  category: z.string().nullable(),
  status: candidacyStatusSchema,
  video_url: z.string().min(1),
  created_at: z.string(),
});
export type CandidateCard = z.infer<typeof candidateCardSchema>;
