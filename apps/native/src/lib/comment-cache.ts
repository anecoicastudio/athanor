import type { InfiniteData } from '@tanstack/react-query';
import type { CommentPage } from '@athanor/api';
import type { PostComment } from '@athanor/schemas';

/**
 * Optimistic-insert cache surgery for a post's reply thread (#101). The comment pages are
 * newest-first (api rule #9 keyset), so the freshest row belongs at the front of the FIRST
 * page; later pages are older history and must be reused untouched. Extracted from the
 * screen for the same reason as `week-slot.ts`: the vitest harness is node-env with a
 * `*.test.ts` glob, so a rule left inside a component is structurally unassertable.
 */
export function prependComment(
  data: InfiniteData<CommentPage> | undefined,
  row: PostComment,
): InfiniteData<CommentPage> {
  if (!data || data.pages.length === 0) {
    return { pages: [{ comments: [row], nextCursor: null }], pageParams: [null] };
  }
  return {
    ...data,
    pages: data.pages.map((page, i) =>
      i === 0 ? { ...page, comments: [row, ...page.comments] } : page,
    ),
  };
}
