import { describe, expect, it } from 'vitest';
import { postReactionInsertSchema } from './post-reaction.ts';

const valid = {
  post_id: '11111111-1111-1111-1111-111111111111',
  person_id: '22222222-2222-2222-2222-222222222222',
};

describe('postReactionInsertSchema', () => {
  it('parses the ✦ insert pair', () => {
    expect(postReactionInsertSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a non-uuid in either slot', () => {
    expect(() => postReactionInsertSchema.parse({ ...valid, post_id: 'p1' })).toThrow();
    expect(() => postReactionInsertSchema.parse({ ...valid, person_id: 'me' })).toThrow();
  });

  it('strips unknown keys so a widened caller cannot smuggle columns', () => {
    const parsed = postReactionInsertSchema.parse({ ...valid, created_at: '2026-01-01' });
    expect(parsed).toEqual(valid);
  });
});
