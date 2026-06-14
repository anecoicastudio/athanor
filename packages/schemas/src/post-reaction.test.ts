import { describe, expect, test } from 'vitest';
import { postReactionInsertSchema, postReactionSchema } from './post-reaction';

describe('postReactionSchema', () => {
  test('parses a valid reaction row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      post_id: '22222222-2222-2222-2222-222222222222',
      person_id: '33333333-3333-3333-3333-333333333333',
      created_at: '2026-06-14T00:00:00Z',
    };
    expect(postReactionSchema.parse(row)).toMatchObject({ post_id: row.post_id });
  });
});

describe('postReactionInsertSchema', () => {
  test('keeps post_id and person_id only', () => {
    const parsed = postReactionInsertSchema.parse({
      post_id: '22222222-2222-2222-2222-222222222222',
      person_id: '33333333-3333-3333-3333-333333333333',
    });
    expect(parsed).toEqual({
      post_id: '22222222-2222-2222-2222-222222222222',
      person_id: '33333333-3333-3333-3333-333333333333',
    });
  });

  test('rejects a non-uuid post_id', () => {
    expect(() => postReactionInsertSchema.parse({ post_id: 'nope', person_id: 'nope' })).toThrow();
  });
});
