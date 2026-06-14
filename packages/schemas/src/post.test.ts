import { describe, expect, test } from 'vitest';
import { postInsertSchema, postSchema } from './post';

describe('postSchema', () => {
  test('parses a valid post row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      author_id: '22222222-2222-2222-2222-222222222222',
      category: 'human',
      type: 'text',
      body: 'Un passo del percorso',
      is_step: true,
      tags: [],
      created_at: '2026-06-14T00:00:00Z',
      updated_at: '2026-06-14T00:00:00Z',
      deleted_at: null,
    };
    expect(postSchema.parse(row)).toMatchObject({ category: 'human', is_step: true });
  });

  test('rejects an unknown category', () => {
    expect(() =>
      postSchema.parse({
        id: '11111111-1111-1111-1111-111111111111',
        author_id: '22222222-2222-2222-2222-222222222222',
        category: 'spam',
        type: 'text',
        body: 'x',
        is_step: false,
        tags: [],
        created_at: '2026-06-14T00:00:00Z',
        updated_at: '2026-06-14T00:00:00Z',
        deleted_at: null,
      }),
    ).toThrow();
  });
});

describe('postInsertSchema', () => {
  test('trims body and requires 1–5000 chars', () => {
    const parsed = postInsertSchema.parse({
      author_id: '22222222-2222-2222-2222-222222222222',
      category: 'creative',
      body: '  ciao  ',
    });
    expect(parsed.body).toBe('ciao');
    expect(parsed.is_step).toBe(false); // default
  });

  test('rejects a blank body', () => {
    expect(() =>
      postInsertSchema.parse({
        author_id: '22222222-2222-2222-2222-222222222222',
        category: 'creative',
        body: '   ',
      }),
    ).toThrow();
  });
});
