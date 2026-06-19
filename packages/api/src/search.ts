import {
  searchResultSchema,
  type SearchResult,
  type SearchScope,
  type SearchFilters,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

/** Opaque keyset cursor — the last (rank, id) seen. Never an offset (rule #9). */
export type SearchCursor = { rank: number; id: string };

const PAGE_SIZE = 20;

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string, scope: SearchScope, filters?: SearchFilters) =>
    [...searchKeys.all, 'query', { q, scope, filters }] as const,
};

/**
 * Full-text search across all entities via the `search_all` SECURITY INVOKER RPC.
 * Returns one keyset page of results. Advanced filters (auraMin, city, star) are silently
 * ignored server-side for non-members — the client passes them as-is and never trusts itself.
 * Never offset-paginated (rule #9).
 */
export async function searchAll(
  client: AthanorClient,
  params: {
    q: string;
    scope: SearchScope;
    filters?: SearchFilters;
    cursor?: SearchCursor | null;
  },
): Promise<{ rows: SearchResult[]; nextCursor: SearchCursor | null }> {
  const { data, error } = await client.rpc('search_all', {
    q: params.q,
    scope: params.scope,
    f_aura_min: params.filters?.auraMin ?? undefined,
    f_city: params.filters?.city ?? undefined,
    f_star: params.filters?.star ?? undefined,
    cursor_rank: params.cursor?.rank ?? undefined,
    cursor_id: params.cursor?.id ?? undefined,
    page_size: PAGE_SIZE,
  });
  if (error) throw error;
  const rows = searchResultSchema.array().parse(data ?? []);
  const nextCursor =
    rows.length === PAGE_SIZE
      ? { rank: rows[rows.length - 1]!.rank, id: rows[rows.length - 1]!.id }
      : null;
  return { rows, nextCursor };
}
