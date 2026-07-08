import {
  type Project,
  type ProjectCategory,
  type ProjectInsert,
  type ProjectStatus,
  type ProjectUpdate,
  projectInsertSchema,
  projectSchema,
  projectUpdateSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

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
    query = query.or(`created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const projects = (data ?? []).map((row) => projectSchema.parse(row));
  const last = projects.length === limit ? projects.at(-1) : undefined;
  const nextCursor = last ? { created_at: last.created_at, id: last.id } : null;
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

/** PARKED(project-edit): edit an own project (owner UPDATE policy). 0 callers — project-edit UI is a tracked follow-up (PRODUCTION-READINESS P5). */
export async function editProject(
  client: AthanorClient,
  id: string,
  patch: ProjectUpdate,
): Promise<Project> {
  const payload = projectUpdateSchema.parse(patch);
  const { data, error } = await client
    .from('projects')
    .update(payload)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .single();
  if (error) throw error;
  return projectSchema.parse(data);
}

/** PARKED(project-edit): toggle a project open/closed (owner UPDATE policy). 0 callers — ships with the project-edit surface (PRODUCTION-READINESS P5). */
export async function setProjectStatus(
  client: AthanorClient,
  id: string,
  status: ProjectStatus,
): Promise<void> {
  const { error } = await client
    .from('projects')
    .update({ status })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}
