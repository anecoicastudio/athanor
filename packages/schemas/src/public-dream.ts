import { z } from 'zod';
import { publicMilestoneSchema } from './public-profile.ts';
import { displayNameSchema, handleSchema } from './profile.ts';

/**
 * The author byline on a public dream page (issue #159).
 *
 * Nullable, and NOT because a member can publish a dream while hiding their identity — they
 * cannot. `dreams_select_anon_public` (20260614144747) reaches the owner's profiles row
 * through a plain `exists`, which anon evaluates under profiles' own RLS, so an
 * identity:'members' or banned member hides the dream row itself; 20260814151601's header
 * calls that out as «CONSEQUENCE, DELIBERATE». By the time a dream reaches this model its
 * owner's shell is anon-readable.
 *
 * What is left is a profile with no handle: nothing to link to and nothing `handleSchema`
 * would accept, so the page renders the quote unattributed. Defensive beyond that — a byline
 * is not worth a 500.
 *
 * Same fields as the #251 default shell on `publicProfileSchema`, and for the same reason:
 * `avatarUrl` is a short-lived SIGNED url against the private avatars bucket, never a
 * storage key.
 */
export const publicDreamAuthorSchema = z.object({
  handle: handleSchema,
  displayName: displayNameSchema.nullable(),
  avatarUrl: z.string().url().nullable(),
});

/**
 * The public dream read-model (issue #159) — what a logged-out visitor and a crawler may see
 * at `/dream/{id}`. Assembled by @athanor/api from anon, RLS-gated reads.
 *
 * Deliberately NOT a `.pick()` of `dreamSchema`: that shape is the owner-facing row, and the
 * difference is a trust boundary rather than a subset. `profile_id` is read to resolve the
 * byline and never returned — a public page names a member by handle, not by internal id.
 * `status` and `deleted_at` are not carried either: RLS only ever returns an active,
 * undeleted dream to anon, so a field for it on this model could only ever say 'active' and
 * would invite a caller to branch on something that cannot vary.
 *
 * `.strict()` so widening the read-model's select fails loudly here rather than silently
 * stripping the extra column and looking fine — the same guard `publicEventSchema` carries.
 */
export const publicDreamSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1),
    milestones: z.array(publicMilestoneSchema),
    author: publicDreamAuthorSchema.nullable(),
  })
  .strict();
export type PublicDream = z.infer<typeof publicDreamSchema>;
export type PublicDreamAuthor = z.infer<typeof publicDreamAuthorSchema>;

/**
 * One entry of the public dream index — what the sitemap lists (#335). Picked from the
 * read-model rather than re-declared, so an id the route could never resolve is withheld from
 * the index instead of advertised into a 404. Still `.strict()`.
 *
 * There is no prerender counterpart: `/dream/[id]` prerenders no params at all (see
 * `apps/web/lib/prerender-limits.ts`), so unlike handles and events this index has exactly
 * one consumer.
 */
export const publicDreamEntrySchema = publicDreamSchema
  .pick({ id: true })
  .extend({ updated_at: z.string() });
export type PublicDreamEntry = z.infer<typeof publicDreamEntrySchema>;
