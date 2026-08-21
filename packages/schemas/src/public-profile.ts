import { z } from 'zod';
// Import and re-export the canonical handleSchema from profile (mirrors profiles.handle CHECK
// ^[a-z0-9_]{3,30}$) so the package index can export * from both files without a name clash.
import { displayNameSchema, handleSchema } from './profile';
export { handleSchema };
export type Handle = string;

/** A public tappa summary (mirrors public.milestone_status). */
export const publicMilestoneSchema = z.object({
  id: z.string(),
  body: z.string(),
  status: z.enum(['open', 'in_progress', 'done']),
});

/**
 * The public-@handle read-model contract (frontend 02 §6). Assembled by
 * @athanor/api from visibility-gated anon reads; `dream` is null unless the dream
 * section is public. `bio` is nullable and currently always null on the anon path
 * (members/private columns aren't granted to anon — public bio is deferred to an
 * M9 SECURITY DEFINER RPC). Mobile PersonDetail and the web @handle page share this shape.
 *
 * `displayName` + `avatarUrl` are the #251 default shell: anon-readable for every member
 * whose `identity` visibility facet is public (the default — migration 20260814151601).
 * `avatarUrl` is a short-lived SIGNED url, never a storage key: the avatars bucket is
 * private, and the anon storage policy is what lets the signing succeed. Both null when the
 * member set none — initials render instead.
 */
export const publicProfileSchema = z.object({
  handle: handleSchema,
  displayName: displayNameSchema.nullable(),
  avatarUrl: z.string().url().nullable(),
  bio: z.string().nullable(),
  dream: z
    .object({
      text: z.string(),
      milestones: z.array(publicMilestoneSchema),
    })
    .nullable(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type PublicMilestone = z.infer<typeof publicMilestoneSchema>;

/**
 * One entry of the public handle index — what `/[handle]` prerenders and what the sitemap
 * lists (#335): the route segment and the row's last change, nothing else. Picked from the
 * read-model rather than re-declared, so a handle the route could never resolve is withheld
 * from the index instead of prerendered into a 404.
 */
export const publicHandleEntrySchema = publicProfileSchema
  .pick({ handle: true })
  .extend({ updated_at: z.string() });
export type PublicHandleEntry = z.infer<typeof publicHandleEntrySchema>;
