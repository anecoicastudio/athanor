import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives.ts';
import { isReservedHandle } from './reserved-handles.ts';
import { birthDateSchema, zodiacSignSchema } from './zodiac.ts';

/** Mirrors supabase/migrations init_profiles. Update both together. */
export const localeSchema = z.enum(['it', 'en']);

export const handleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscore only');

/**
 * The handle shape on a WRITE path — the same characters, minus the reserved words (#430).
 *
 * Deliberately a second schema rather than a refinement on `handleSchema`: that one is what
 * `publicProfileSchema`, `personProfileSchema` and `publicEventSchema` parse rows WITH, and the
 * reserved list will be widened again. A read schema that refuses reserved handles would start
 * withholding rows the database still holds on the day the list grows — silently shrinking a
 * public profile page for a handle that was legal when it was claimed. The database CHECK is
 * what keeps such rows from existing; this is the early, well-messaged refusal on the way in.
 */
export const claimableHandleSchema = handleSchema.refine((h) => !isReservedHandle(h), {
  message: 'this handle is reserved',
});

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

/**
 * Precision-5 geohash of the picked city's coordinates (#149) — the column
 * CHECK pins the same shape (5 chars, geohash base32: no a, i, l, o). NULL
 * whenever the city was typed free text instead of picked.
 */
export const cityGeohashSchema = z.string().regex(/^[0-9b-hjkmnp-z]{5}$/);

export const profileSchema = z.object({
  id: z.string().uuid(),
  handle: handleSchema.nullable(),
  display_name: displayNameSchema.nullable(),
  avatar_path: avatarPathSchema.nullable(),
  bio: z.string().max(500).nullable(),
  // #149 — mission/skills/profession/city, all nullable: a profile that says
  // nothing is a first-class state. Caps mirror the column CHECKs; vocabulary
  // membership (skills/profession) is @athanor/core's job, not shape's.
  mission: z.string().max(500).nullable(),
  skills: z.array(z.string()).max(10).nullable(),
  profession: z.string().max(40).nullable(),
  city: z.string().max(80).nullable(),
  city_geohash: cityGeohashSchema.nullable(),
  locale: localeSchema,
  visibility: z.record(z.enum(['public', 'members', 'private'])),
  identity_tags: z.array(z.string()).max(10),
  seeking: z.array(z.string()).max(10),
  identity_verified: z.boolean(),
  founding_member: z.boolean(),
  // #694 — birth_date is OWN-read only (no client SELECT grant; get_own_profile's DEFINER
  // `select *` is the sole path), zodiac_sign is generated from it server-side. Both nullable:
  // pre-#694 members have neither. Listed here or Zod strips them silently on the way in.
  birth_date: birthDateSchema.nullable(),
  zodiac_sign: zodiacSignSchema.nullable(),
  // Moderation state (#106) — server-written only (clients hold no write grant), but the
  // OWN read does see them: `get_own_profile()` is a DEFINER `select *`, so its row carries
  // both columns past the column-scoped grants (0072 asserts the full-row read) — that is
  // what the SuspendedNotice banner renders (#312). Optional: third-person projections
  // (`get_person_profile`) never include them.
  suspended_until: z.string().nullable().optional(),
  banned_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const profileUpdateSchema = profileSchema
  .pick({
    avatar_path: true,
    bio: true,
    mission: true,
    skills: true,
    profession: true,
    city: true,
    city_geohash: true,
    locale: true,
    visibility: true,
    identity_tags: true,
    seeking: true,
    // #694 — the owner may set (or clear) their date later; zodiac_sign is generated and has
    // no write grant, so it is deliberately absent from this pick.
    birth_date: true,
  })
  // The two fields whose write shape differs from their read shape, added here rather than
  // picked above and overridden (a picked entry the extend replaces is a flag that does nothing):
  // the edit form hands over whatever was typed, padding included, and the column's CHECK
  // measures `btrim`; and a handle being CLAIMED is held to the reserved list a handle being
  // READ is not (#430).
  .extend({
    display_name: displayNameWriteSchema.nullable(),
    handle: claimableHandleSchema.nullable(),
  })
  .partial();

/**
 * Third-person profile as projected by the `get_person_profile` DEFINER RPC
 * (M10 visibility enforcement): bio/identity_tags/seeking are NULL when the
 * owner set that field to 'private' (absent key = 'members'). No locale,
 * visibility, or other own-only columns.
 *
 * `display_name` and `avatar_path` are never masked here (#76): they enrich the handle a
 * member already sees, so a members-side mask would be a second identity setting with nothing
 * behind it. The `identity` visibility facet (#251) gates the ANON shell only — it decides
 * whether `apps/web`'s @handle page resolves at all, never what a signed-in member sees.
 */
export const personProfileSchema = profileSchema
  .pick({
    id: true,
    handle: true,
    display_name: true,
    avatar_path: true,
    bio: true,
    mission: true,
    skills: true,
    profession: true,
    city: true,
    // #694 — public by decision, no visibility key; NULL on a tombstone. birth_date is never
    // picked here: the RPC does not project it, and this schema must not suggest it could.
    zodiac_sign: true,
    identity_verified: true,
    founding_member: true,
  })
  // visibility-gated fields arrive NULL when hidden (bio and the #149 fields are already
  // nullable); identity_tags and seeking join here with the nullable wrapper rather than being
  // picked above and overridden. city_geohash is deliberately absent: the RPC never projects
  // another member's cell (20260814104755).
  .extend({
    identity_tags: profileSchema.shape.identity_tags.nullable(),
    seeking: profileSchema.shape.seeking.nullable(),
    /**
     * True when this member was BANNED (#314). The row still resolves — that is deliberate —
     * but every identity and content column above arrives NULL and both badges arrive false,
     * so there is nothing to render but the tombstone.
     *
     * This flag is the whole reason the RPC returns a row at all. Zero rows already means
     * «no such person, or blocked», and a reply surviving inside someone else's thread would
     * then be attributed to the same generic «·» that a blocked stranger gets — the ruling
     * asks for «account removed», which is a different statement. GDPR erasure (#107) is a
     * separate mechanism and does not surface here: it deletes the row outright.
     */
    removed: z.boolean(),
  });

export type Locale = z.infer<typeof localeSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type PersonProfile = z.infer<typeof personProfileSchema>;
