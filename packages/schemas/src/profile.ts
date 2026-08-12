import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives';

/** Mirrors supabase/migrations init_profiles. Update both together. */
export const localeSchema = z.enum(['it', 'en']);

export const handleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscore only');

/**
 * Optional human name (#75), read side. 60 is the column CHECK
 * (`char_length(btrim(display_name)) between 1 and 60`). @handle stays the identity — this and
 * the avatar only enrich it, so both are nullable and a profile with neither is a first-class
 * state, not a gap.
 *
 * `nonBlankString`, not `trimmedNonBlank`, and the split is the point (primitives.ts): a read
 * schema that trims rewrites the row on the way in, so what the screen renders is no longer
 * what the column holds. Normalisation happens once, on write.
 */
export const displayNameSchema = nonBlankString(60, 'display name must not be blank');

/** Write side: trim first, then 1..60 — the client's input is normalised before it reaches the column. */
export const displayNameWriteSchema = trimmedNonBlank(60);

/**
 * Storage key in the private `avatars` bucket, `{uid}/{uid}.{ext}` — never a URL. Rendered
 * through a short-lived signed URL (`BUCKET_URL_TTL.avatars`).
 */
export const avatarPathSchema = z.string().max(512);

/**
 * The three fields that answer «who is this» wherever a member appears as the *other* party in a
 * list — conversations, connections, requests, blocks (#76).
 *
 * Spread rather than re-declared per read model: they are one shape, and a fourth list that
 * forgot one of them is exactly how an avatar ends up rendering an initial next to a member who
 * has a photograph everywhere else.
 */
export const peerIdentityFields = {
  // Deliberately looser than `handleSchema`: this is a read model, and a row that somehow holds
  // an off-pattern handle should render, not throw in a list of forty.
  peerHandle: z.string().nullable(),
  peerDisplayName: displayNameSchema.nullable(),
  peerAvatarPath: avatarPathSchema.nullable(),
};

export const profileSchema = z.object({
  id: z.string().uuid(),
  handle: handleSchema.nullable(),
  display_name: displayNameSchema.nullable(),
  avatar_path: avatarPathSchema.nullable(),
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
  // The only field whose write shape differs from its read shape: the edit form hands over
  // whatever was typed, padding included, and the column's CHECK measures `btrim`.
  .extend({ display_name: displayNameWriteSchema.nullable() })
  .partial();

/**
 * Third-person profile as projected by the `get_person_profile` DEFINER RPC
 * (M10 visibility enforcement): bio/identity_tags/seeking are NULL when the
 * owner set that field to 'private' (absent key = 'members'). No locale,
 * visibility, or other own-only columns.
 *
 * `display_name` and `avatar_path` carry no visibility key and are never masked here (#76):
 * they enrich the handle a member already sees, so gating them would be a second identity
 * setting with nothing behind it. The RPC's members-only reach is the boundary — anon is
 * excluded from both columns at the grant (20260811074859), so `apps/web` still renders initials.
 */
export const personProfileSchema = profileSchema
  .pick({
    id: true,
    handle: true,
    display_name: true,
    avatar_path: true,
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
