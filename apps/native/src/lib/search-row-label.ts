import type { SearchResult } from '@athanor/schemas';

/**
 * The screen-reader label of a search result row. On the person arm `title` is the handle and
 * `subtitle` the bio, so the member's display name reached assistive tech only through the
 * avatar's own label — and the avatar is decorative inside a row that names the member (#884).
 * The row says the name itself now, ahead of the handle the result list highlights. Empty parts
 * are skipped, so a result with no bio never ends on a dangling comma.
 */
export function searchRowLabel(
  result: Pick<SearchResult, 'entity_type' | 'title' | 'subtitle' | 'display_name'>,
): string {
  const name = result.entity_type === 'person' ? result.display_name?.trim() : undefined;
  return [name, result.title, result.subtitle].filter(Boolean).join(', ');
}
