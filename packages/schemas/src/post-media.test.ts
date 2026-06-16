import { describe, expect, it } from 'vitest';
import { postMediaInsertSchema, postMediaSchema } from './post-media';

describe('postMediaSchema', () => {
  it('parses a valid row', () => {
    expect(() =>
      postMediaSchema.parse({
        id: '00000000-0000-0000-0000-000000000001',
        post_id: '00000000-0000-0000-0000-000000000002',
        kind: 'image',
        storage_path: 'uid/post/0.jpg',
        duration_s: null,
        width: 800,
        height: 600,
        position: 0,
        created_at: 'now',
        updated_at: 'now',
      }),
    ).not.toThrow();
  });
  it('rejects an unknown kind', () => {
    expect(() =>
      postMediaInsertSchema.parse({
        post_id: '00000000-0000-0000-0000-000000000002',
        kind: 'gif',
        storage_path: 'p',
        position: 0,
      }),
    ).toThrow();
  });
});
