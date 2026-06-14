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
});
