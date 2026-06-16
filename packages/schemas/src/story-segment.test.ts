import { describe, expect, it } from 'vitest';
import { storySegmentInsertSchema, storySegmentSchema } from './story-segment';

const valid = {
  id: '11111111-1111-1111-1111-111111111111',
  author_id: '22222222-2222-2222-2222-222222222222',
  kind: 'photo',
  storage_path: '22222222/seg1.jpg',
  duration_s: null,
  caption: null,
  is_step: false,
  pinned: false,
  expires_at: '2026-06-16T00:00:00.000Z',
  created_at: '2026-06-15T00:00:00.000Z',
  updated_at: '2026-06-15T00:00:00.000Z',
  deleted_at: null,
};

describe('storySegmentSchema', () => {
  it('parses a valid row', () => {
    expect(storySegmentSchema.parse(valid)).toMatchObject({ kind: 'photo', is_step: false });
  });
  it('rejects an unknown kind', () => {
    expect(() => storySegmentSchema.parse({ ...valid, kind: 'audio' })).toThrow();
  });
  it('rejects a caption over 280 chars', () => {
    expect(() => storySegmentSchema.parse({ ...valid, caption: 'x'.repeat(281) })).toThrow();
  });
});

describe('storySegmentInsertSchema', () => {
  it('defaults the optional fields', () => {
    const parsed = storySegmentInsertSchema.parse({
      author_id: valid.author_id,
      kind: 'video',
      storage_path: '22222222/seg2.mp4',
    });
    expect(parsed).toMatchObject({ is_step: false, duration_s: null, caption: null });
  });
});
