import { z } from 'zod';
// Import and re-export the canonical handleSchema from profile (mirrors profiles.handle CHECK
// ^[a-z0-9_]{3,30}$) so the package index can export * from both files without a name clash.
import { handleSchema } from './profile';
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
 */
export const publicProfileSchema = z.object({
  handle: handleSchema,
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
