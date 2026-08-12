import {
  type Project,
  type ProjectCategory,
  type ProjectInsert,
  projectInsertSchema,
  projectSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';

export const projectKeys = {
  all: ['projects'] as const,
  list: (category: ProjectCategory | 'all') => ['projects', 'list', category] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
};

/** Opaque keyset cursor — the last (created_at, id) the caller has seen. Never an offset. */
export type ProjectCursor = { created_at: string; id: string };
export type ProjectPage = { projects: Project[]; nextCursor: ProjectCursor | null };

const BOARD_PAGE_SIZE = 20;

/**
 * One page of the Costellazioni board, newest-first by the (created_at, id) keyset
 * (rule #9: never offset). `category: 'all'` spans every category.
 */
export async function getProjectsPage(
  client: AthanorClient,
  opts: { category: ProjectCategory | 'all'; cursor?: ProjectCursor | null; limit?: number } = {
    category: 'all',
  },
): Promise<ProjectPage> {
  const limit = opts.limit ?? BOARD_PAGE_SIZE;
  let query = client
    .from('projects')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (opts.category !== 'all') query = query.eq('category', opts.category);

  if (opts.cursor) {
    const { created_at, id } = opts.cursor;
    query = query.or(keysetFilter('created_at', 'id', created_at, id, 'lt'));
  }

  const { data, error } = await query;
  if (error) throw error;
  const projects = (data ?? []).map((row) => projectSchema.parse(row));
  const nextCursor = nextCursorOf(projects, limit, (last) => ({
    created_at: last.created_at,
    id: last.id,
  }));
  return { projects, nextCursor };
}

/** A single project (modal detail). Null when missing or soft-deleted. */
export async function getProject(client: AthanorClient, id: string): Promise<Project | null> {
  const { data, error } = await client
    .from('projects')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return projectSchema.parse(data);
}

/**
 * Publish a project. RLS enforces author = (select auth.uid()). Creating a project
 * is the +4 domain event the M6 engine reads — this writes only `projects`, never
 * Aura (rule #1). TODO(M6): the score-engine (backend `07`) consumes this insert.
 */
export async function createProject(
  client: AthanorClient,
  insert: ProjectInsert,
): Promise<Project> {
  const payload = projectInsertSchema.parse(insert);
  const { data, error } = await client.from('projects').insert(payload).select('*').single();
  if (error) throw error;
  return projectSchema.parse(data);
}
