import { z } from 'zod';

/** Mirrors supabase/migrations init_profiles. Update both together. */
export const localeSchema = z.enum(['it', 'en']);

export const handleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscore only');

export const profileSchema = z.object({
  id: z.string().uuid(),
  handle: handleSchema.nullable(),
  bio: z.string().max(500).nullable(),
  locale: localeSchema,
  visibility: z.record(z.enum(['public', 'members', 'private'])),
  identity_tags: z.array(z.string()).max(10),
  seeking: z.array(z.string()).max(10),
  created_at: z.string(),
  updated_at: z.string(),
});

export const profileUpdateSchema = profileSchema
  .pick({
    handle: true,
    bio: true,
    locale: true,
    visibility: true,
    identity_tags: true,
    seeking: true,
  })
  .partial();

export type Locale = z.infer<typeof localeSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
