import { z } from 'zod';

/** Mirrors supabase/migrations milestone_helps. Update both together. NO 'contribution' (Fase 1). */
export const helpTypeSchema = z.enum(['skill', 'connection', 'opportunity']);
export const helpStatusSchema = z.enum(['offered', 'accepted', 'declined', 'completed']);

const helpMessageSchema = z.string().trim().max(500);
const helpLinkSchema = z.string().regex(/^https?:\/\//, 'link must be http(s)');

export const helpSchema = z.object({
  id: z.string().uuid(),
  milestone_id: z.string().uuid(),
  helper_id: z.string().uuid(),
  type: helpTypeSchema,
  message: helpMessageSchema.nullable(),
  link: helpLinkSchema.nullable(),
  status: helpStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Helper creates the offer — helper_id comes from auth, status defaults 'offered' server-side. */
export const helpInsertSchema = z.object({
  milestone_id: z.string().uuid(),
  type: helpTypeSchema,
  message: helpMessageSchema.optional(),
  link: helpLinkSchema.optional(),
});

/** Owner transitions an offer — only the reachable non-'offered' targets. */
export const helpRespondSchema = z.object({
  status: z.enum(['accepted', 'declined', 'completed']),
});

export type HelpType = z.infer<typeof helpTypeSchema>;
export type HelpStatus = z.infer<typeof helpStatusSchema>;
export type Help = z.infer<typeof helpSchema>;
export type HelpInsert = z.infer<typeof helpInsertSchema>;
export type HelpRespond = z.infer<typeof helpRespondSchema>;
