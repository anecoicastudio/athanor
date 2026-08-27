import { describe, expect, test } from 'vitest';
import { postCategorySchema, postInsertSchema, postSchema, postTypeSchema } from './post.ts';

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

// Mirrors feed_posts — the literal list, never a loop over the constant.
describe('post vocabularies', () => {
  test('category is business | human | creative | evolution', () => {
    expect(postCategorySchema.options).toEqual(['business', 'human', 'creative', 'evolution']);
    for (const bad of ['spam', 'art', '']) {
      expect(postCategorySchema.safeParse(bad).success).toBe(false);
    }
  });

  test('type is text | image | video | audio', () => {
    expect(postTypeSchema.options).toEqual(['text', 'image', 'video', 'audio']);
    for (const bad of ['gif', 'link', '']) {
      expect(postTypeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('postInsertSchema shape', () => {
  const insert = {
    author_id: '22222222-2222-2222-2222-222222222222',
    category: 'creative',
    body: 'ciao',
  };

  test('carries exactly author, category, body and the three defaulted fields', () => {
    expect(Object.keys(postInsertSchema.shape).sort()).toEqual([
      'author_id',
      'body',
      'category',
      'is_step',
      'tags',
      'type',
    ]);
  });

  test('defaults type to text and tags to an empty list — not a placeholder tag', () => {
    const parsed = postInsertSchema.parse(insert);
    expect(parsed.type).toBe('text');
    expect(parsed.tags).toEqual([]);
  });

  test('requires author_id and category', () => {
    for (const key of ['author_id', 'category'] as const) {
      const { [key]: _dropped, ...without } = insert;
      expect(postInsertSchema.safeParse(without).success).toBe(false);
    }
  });
});
