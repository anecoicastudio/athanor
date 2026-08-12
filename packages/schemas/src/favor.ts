import { z } from 'zod';
import { nonBlankString } from './primitives';
import { avatarPathSchema, displayNameSchema } from './profile';

/** Mirrors supabase/migrations favor_offers. Update both together. */
export const favorOfferSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid(),
  target_id: z.string().uuid(),
  // (former extra .min(1) dropped — the non-blank refine already implies length ≥ 1)
  need: nonBlankString(280, 'need cannot be blank'),
  need_milestone_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Client-writable shape — actor_id is set from auth.uid via RLS, never sent by the client. */
export const favorInsertSchema = favorOfferSchema.pick({
  target_id: true,
  need: true,
  need_milestone_id: true,
});

/** A row of the `favor_needs` view — a person with an open need to help. */
export const favorNeedSchema = z.object({
  need_milestone_id: z.string().uuid(),
  need: z.string(),
  need_created_at: z.string(),
  target_id: z.string().uuid(),
  target_handle: z.string().nullable(),
  target_display_name: displayNameSchema.nullable(),
  target_avatar_path: avatarPathSchema.nullable(),
});

export type FavorOffer = z.infer<typeof favorOfferSchema>;
export type FavorInsert = z.infer<typeof favorInsertSchema>;
export type FavorNeed = z.infer<typeof favorNeedSchema>;
