import { describe, expect, it } from 'vitest';
import { storyReactionInsertSchema, storyReactionSchema } from './story-reaction';

const valid = {
  id: '11111111-1111-1111-1111-111111111111',
  segment_id: '22222222-2222-2222-2222-222222222222',
  person_id: '33333333-3333-3333-3333-333333333333',
  created_at: '2026-06-15T00:00:00.000Z',
};

describe('storyReactionSchema', () => {
  it('parses a valid row', () => {
    expect(storyReactionSchema.parse(valid)).toMatchObject({ segment_id: valid.segment_id });
  });
  it('rejects a non-uuid segment_id', () => {
    expect(() => storyReactionSchema.parse({ ...valid, segment_id: 'nope' })).toThrow();
  });
});

describe('storyReactionInsertSchema', () => {
  it('picks only segment_id + person_id', () => {
    const parsed = storyReactionInsertSchema.parse({
      segment_id: valid.segment_id,
      person_id: valid.person_id,
    });
    expect(Object.keys(parsed).sort()).toEqual(['person_id', 'segment_id']);
  });
});
