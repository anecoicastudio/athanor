import { z } from 'zod';

/** Mirrors supabase/migrations init_profiles. Update both together. */
export const localeSchema = z.enum(['it', 'en']);

export const handleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscore only');

/**
 * Optional human name (#75). 60 is the column CHECK; the DB additionally caps the raw string,
 * because `btrim` in that CHECK counts a padded name as short. @handle stays the identity —
 * this and the avatar only enrich it, so both are nullable and a profile with neither is
 * a first-class state, not a gap.
 */
export const displayNameSchema = z.string().trim().min(1).max(60);

export const profileSchema = z.object({
  id: z.string().uuid(),
  handle: handleSchema.nullable(),
  display_name: displayNameSchema.nullable(),
  /** Storage key in the private `avatars` bucket, `{uid}/{uid}.{ext}` — never a URL. */
  avatar_path: z.string().max(512).nullable(),
  bio: z.string().max(500).nullable(),
  locale: localeSchema,
  visibility: z.record(z.enum(['public', 'members', 'private'])),
  identity_tags: z.array(z.string()).max(10),
  seeking: z.array(z.string()).max(10),
  identity_verified: z.boolean(),
  founding_member: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const profileUpdateSchema = profileSchema
  .pick({
    handle: true,
    display_name: true,
    avatar_path: true,
    bio: true,
    locale: true,
    visibility: true,
    identity_tags: true,
    seeking: true,
  })
  .partial();

/**
 * Third-person profile as projected by the `get_person_profile` DEFINER RPC
 * (M10 visibility enforcement): bio/identity_tags/seeking are NULL when the
 * owner set that field to 'private' (absent key = 'members'). No locale,
 * visibility, or other own-only columns.
 */
export const personProfileSchema = profileSchema
  .pick({
    id: true,
    handle: true,
    bio: true,
    identity_tags: true,
    seeking: true,
    identity_verified: true,
    founding_member: true,
  })
  // visibility-gated fields arrive NULL when hidden (bio is already nullable)
  .extend({
    identity_tags: profileSchema.shape.identity_tags.nullable(),
    seeking: profileSchema.shape.seeking.nullable(),
  });

export type Locale = z.infer<typeof localeSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type PersonProfile = z.infer<typeof personProfileSchema>;
