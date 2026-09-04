import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives.ts';

/** Mirrors supabase/migrations dream_milestones. Update both together. */
export const milestoneStatusSchema = z.enum(['open', 'in_progress', 'done']);

export const milestoneSchema = z.object({
  id: z.string().uuid(),
  dream_id: z.string().uuid(),
  body: nonBlankString(200, 'milestone body must not be blank'),
  status: milestoneStatusSchema,
  position: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Shared write-path rule for a tappa body: trim, then 1–200 chars (mirrors the DB CHECK). */
const milestoneBodySchema = trimmedNonBlank(200, 'milestone body must not be blank');

/** Adding a tappa — owner sets dream_id + body; status/position default server-side. */
export const milestoneInsertSchema = milestoneSchema
  .pick({ dream_id: true })
  .extend({ body: milestoneBodySchema });

/** Owner marks a tappa done / in_progress — status only. */
export const milestoneStatusUpdateSchema = milestoneSchema.pick({ status: true });

export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type MilestoneInsert = z.infer<typeof milestoneInsertSchema>;
export type MilestoneStatusUpdate = z.infer<typeof milestoneStatusUpdateSchema>;
