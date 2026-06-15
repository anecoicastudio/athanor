import { z } from 'zod';

/** Mirrors supabase/migrations community_projects. Update both together. */
export const projectCategorySchema = z.enum([
  'startup',
  'artistic',
  'business',
  'scientific',
  'volunteer',
]);
export const projectStatusSchema = z.enum(['open', 'closed']);

export const projectSchema = z.object({
  id: z.string().uuid(),
  author_id: z.string().uuid(),
  title: z.string().min(1).max(140),
  category: projectCategorySchema,
  description: z.string().max(4000),
  terms: z.string().max(500).nullable(),
  status: projectStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Shared write-path rule for the title: trim, then 1–140 chars. */
const projectTitleSchema = z.string().trim().min(1, 'project title must not be blank').max(140);

/** Publishing a project — title required; status defaults to 'open', description optional. */
export const projectInsertSchema = projectSchema.pick({ author_id: true, category: true }).extend({
  title: projectTitleSchema,
  description: z.string().max(4000).default(''),
  terms: z.string().max(500).nullable().default(null),
});

/** Editing an own project — any of title/category/description/terms/status. */
export const projectUpdateSchema = z
  .object({
    title: projectTitleSchema,
    category: projectCategorySchema,
    description: z.string().max(4000),
    terms: z.string().max(500).nullable(),
    status: projectStatusSchema,
  })
  .partial();

export type Project = z.infer<typeof projectSchema>;
export type ProjectCategory = z.infer<typeof projectCategorySchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ProjectInsert = z.infer<typeof projectInsertSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
