import { describe, expect, test } from 'vitest';
import { postCommentInsertSchema, postCommentSchema } from './post-comment';

describe('postCommentSchema', () => {
  test('parses a valid comment row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      post_id: '22222222-2222-2222-2222-222222222222',
      author_id: '33333333-3333-3333-3333-333333333333',
      parent_id: null,
      body: 'Bel passo',
      created_at: '2026-06-14T00:00:00Z',
      updated_at: '2026-06-14T00:00:00Z',
      deleted_at: null,
    };
    expect(postCommentSchema.parse(row)).toMatchObject({ body: 'Bel passo' });
  });
});

describe('postCommentInsertSchema', () => {
  test('trims body and requires 1–2000 chars', () => {
    const parsed = postCommentInsertSchema.parse({
      post_id: '22222222-2222-2222-2222-222222222222',
      author_id: '33333333-3333-3333-3333-333333333333',
      body: '  ciao  ',
    });
    expect(parsed.body).toBe('ciao');
    expect(parsed.parent_id).toBeNull();
  });

  test('rejects a blank body', () => {
    expect(() =>
      postCommentInsertSchema.parse({
        post_id: '22222222-2222-2222-2222-222222222222',
        author_id: '33333333-3333-3333-3333-333333333333',
        body: '   ',
      }),
    ).toThrow();
  });

  // #101: the composer supplies its optimistic row's uuid as the insert's PK, so a retried
  // insert whose first response was lost conflicts on the key instead of double-posting.
  test('passes a client-generated id through, and stays valid without one', () => {
    const base = {
      post_id: '22222222-2222-2222-2222-222222222222',
      author_id: '33333333-3333-3333-3333-333333333333',
      body: 'ciao',
    };
    expect(
      postCommentInsertSchema.parse({ ...base, id: '44444444-4444-4444-4444-444444444444' }).id,
    ).toBe('44444444-4444-4444-4444-444444444444');
    expect(postCommentInsertSchema.parse(base).id).toBeUndefined();
    expect(() => postCommentInsertSchema.parse({ ...base, id: 'not-a-uuid' })).toThrow();
  });
});
