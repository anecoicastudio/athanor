import { z } from 'zod';

/** Mirrors supabase/migrations moments. Update both together. */
export const momentKindSchema = z.enum(['photo', 'video']);
const captionSchema = z.string().trim().max(280).nullable();

export const momentSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  kind: momentKindSchema,
  media_path: z.string().min(1),
  thumb_path: z.string().nullable(),
  caption: captionSchema,
  duration_s: z.number().int().min(0).max(60).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

export const momentInsertSchema = momentSchema
  .pick({ owner_id: true, kind: true, media_path: true })
  .extend({
    thumb_path: z.string().nullable().default(null),
    caption: captionSchema.default(null),
    duration_s: z.number().int().min(0).max(60).nullable().default(null),
    width: z.number().int().positive().nullable().default(null),
    height: z.number().int().positive().nullable().default(null),
  });

export type MomentKind = z.infer<typeof momentKindSchema>;
export type Moment = z.infer<typeof momentSchema>;
export type MomentInsert = z.infer<typeof momentInsertSchema>;
