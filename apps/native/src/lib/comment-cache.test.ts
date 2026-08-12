import { describe, expect, it } from 'vitest';
import type { InfiniteData } from '@tanstack/react-query';
import type { CommentPage } from '@athanor/api';
import type { PostComment } from '@athanor/schemas';
import { prependComment } from './comment-cache';

const row = (id: string, body = 'ciao'): PostComment => ({
  id,
  post_id: '22222222-2222-2222-2222-222222222222',
  author_id: '33333333-3333-3333-3333-333333333333',
  parent_id: null,
  body,
  created_at: '2026-08-12T00:00:00Z',
  updated_at: '2026-08-12T00:00:00Z',
  deleted_at: null,
});

const cache = (...pages: PostComment[][]): InfiniteData<CommentPage> => ({
  pages: pages.map((comments, i) => ({
    comments,
    nextCursor: i < pages.length - 1 ? { created_at: 'c', id: 'x' } : null,
  })),
  pageParams: pages.map((_, i) => (i === 0 ? null : { created_at: 'c', id: 'x' })),
});

describe('prependComment', () => {
  it('puts the new row at the front of the first page, later pages untouched', () => {
    const prev = cache([row('a')], [row('b')]);
    const next = prependComment(prev, row('new'));
    expect(next.pages[0]!.comments.map((c) => c.id)).toEqual(['new', 'a']);
    expect(next.pages[1]).toBe(prev.pages[1]);
  });

  it('does not mutate the previous cache value', () => {
    const prev = cache([row('a')]);
    prependComment(prev, row('new'));
    expect(prev.pages[0]!.comments.map((c) => c.id)).toEqual(['a']);
  });

  it('builds a one-page shape when the cache is empty', () => {
    const next = prependComment(undefined, row('new'));
    expect(next.pages).toHaveLength(1);
    expect(next.pages[0]!.comments.map((c) => c.id)).toEqual(['new']);
    expect(next.pages[0]!.nextCursor).toBeNull();
    expect(next.pageParams).toEqual([null]);
  });
});
