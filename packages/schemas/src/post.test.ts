import { describe, expect, test } from 'vitest';
import {
  postCategorySchema,
  postInsertSchema,
  postPublishResultSchema,
  postPublishSchema,
  postSchema,
  postTypeSchema,
} from './post.ts';

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

  test('carries exactly author, category, body, the optional id and the three defaulted fields', () => {
    expect(Object.keys(postInsertSchema.shape).sort()).toEqual([
      'author_id',
      'body',
      'category',
      'id',
      'is_step',
      'tags',
      'type',
    ]);
  });

  // #579: the composer's client-minted PK. A dropped `id` is the duplicate post it exists to
  // prevent, and it fails silently — zod strips an undeclared key — so it is asserted by value.
  test('keeps a client-minted id instead of stripping it', () => {
    const id = '33333333-3333-3333-3333-333333333333';
    expect(postInsertSchema.parse({ ...insert, id }).id).toBe(id);
  });

  test('id is optional, and absent rather than null when omitted', () => {
    const parsed = postInsertSchema.parse(insert);
    expect(parsed.id).toBeUndefined();
    expect('id' in parsed).toBe(false);
  });

  test('rejects an id that is not a uuid', () => {
    for (const bad of ['', 'not-a-uuid', '3333333-3333-3333-3333-333333333333']) {
      expect(postInsertSchema.safeParse({ ...insert, id: bad }).success).toBe(false);
    }
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

describe('postPublishSchema', () => {
  const publish = { category: 'creative', body: 'ciao' };

  // #588: the RPC reads auth.uid(). The field is subtracted rather than merely ignored, so a
  // caller cannot even spell it — asserted on the shape, because a schema that still declared
  // it would parse every case below identically and only differ on the wire.
  test('carries the insert shape minus author_id', () => {
    expect(Object.keys(postPublishSchema.shape).sort()).toEqual([
      'body',
      'category',
      'id',
      'is_step',
      'tags',
      'type',
    ]);
  });

  test('parses a payload that names no author', () => {
    const parsed = postPublishSchema.parse(publish);
    expect(parsed.body).toBe('ciao');
    expect('author_id' in parsed).toBe(false);
  });

  test('strips an author_id a caller sends anyway', () => {
    const parsed = postPublishSchema.parse({
      ...publish,
      author_id: '22222222-2222-2222-2222-222222222222',
    });
    expect('author_id' in parsed).toBe(false);
  });

  // The rules it inherits rather than restates — a re-declared shape would drift from these.
  test('keeps the insert body rule, the defaults and the optional client-minted id', () => {
    const id = '33333333-3333-3333-3333-333333333333';
    const parsed = postPublishSchema.parse({ ...publish, body: '  ciao  ', id });
    expect(parsed).toEqual({
      id,
      category: 'creative',
      body: 'ciao',
      type: 'text',
      is_step: false,
      tags: [],
    });
    expect(postPublishSchema.safeParse({ ...publish, body: '   ' }).success).toBe(false);
    expect(postPublishSchema.safeParse({ body: 'ciao' }).success).toBe(false);
  });
});

describe('postPublishResultSchema', () => {
  const post = {
    id: '11111111-1111-1111-1111-111111111111',
    author_id: '22222222-2222-2222-2222-222222222222',
    category: 'human',
    type: 'image',
    body: 'Un passo del percorso',
    is_step: false,
    tags: [],
    created_at: '2026-06-14T00:00:00Z',
    updated_at: '2026-06-14T00:00:00Z',
    deleted_at: null,
  };
  const media = {
    id: '44444444-4444-4444-4444-444444444444',
    post_id: '11111111-1111-1111-1111-111111111111',
    kind: 'image',
    storage_path: 'u1/p1/0.jpg',
    thumb_path: null,
    duration_s: null,
    width: 1080,
    height: 1350,
    position: 0,
    created_at: '2026-06-14T00:00:00Z',
    updated_at: '2026-06-14T00:00:00Z',
  };

  test('parses the post and its media set', () => {
    const parsed = postPublishResultSchema.parse({ post, media: [media] });
    expect(parsed.post.id).toBe(post.id);
    expect(parsed.media).toHaveLength(1);
  });

  // An empty set is a post that no longer carries media (#586), not a missing answer.
  test('accepts an empty media set', () => {
    expect(postPublishResultSchema.parse({ post, media: [] }).media).toEqual([]);
  });

  test('rejects a malformed post or a malformed row rather than half-parsing', () => {
    expect(
      postPublishResultSchema.safeParse({ post: { ...post, category: 'spam' }, media: [] }).success,
    ).toBe(false);
    expect(
      postPublishResultSchema.safeParse({ post, media: [{ ...media, kind: 'gif' }] }).success,
    ).toBe(false);
    expect(postPublishResultSchema.safeParse({ post }).success).toBe(false);
  });
});
