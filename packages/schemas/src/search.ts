import { z } from 'zod';
import { starKeySchema } from './aura.ts';
import { avatarPathSchema, displayNameSchema } from './profile.ts';

export const searchScopeSchema = z.enum(['all', 'people', 'projects', 'events', 'marketplace']);
export type SearchScope = z.infer<typeof searchScopeSchema>;

export const searchEntitySchema = z.enum(['person', 'project', 'event']); // 'listing' added Fase 3
export type SearchEntity = z.infer<typeof searchEntitySchema>;

export const searchResultSchema = z.object({
  entity_type: searchEntitySchema,
  id: z.string().uuid(),
  title: z.string(),
  subtitle: z.string(),
  /** Person arm only — a project and an event have no face (#76). */
  display_name: displayNameSchema.nullable(),
  avatar_path: avatarPathSchema.nullable(),
  rank: z.number(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchFiltersSchema = z
  .object({
    auraMin: z.number().int().min(0).max(1000).optional(),
    city: z.string().max(80).optional(),
    // The Six Stars themselves (aura.ts STAR_KEYS) — one vocabulary, not a second copy of it.
    star: starKeySchema.optional(),
  })
  .partial();
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
