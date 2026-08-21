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
    expect(storySegmentSchema.parse({ ...valid, caption: 'x'.repeat(280) }).caption).toHaveLength(
      280,
    );
  });

  // A length bound measured before trimming is a different bound: '  x  '.length is 5, not 1.
  // The shared captionSchema trims first, and only an assertion on the parsed value says so.
  it('trims the caption before measuring it', () => {
    expect(storySegmentSchema.parse({ ...valid, caption: '  ok  ' }).caption).toBe('ok');
  });

  it('bounds duration_s to a ≤60s clip, integer, non-negative (mirrors the story_segments CHECK)', () => {
    expect(storySegmentSchema.parse({ ...valid, duration_s: 60 }).duration_s).toBe(60);
    expect(storySegmentSchema.parse({ ...valid, duration_s: 0 }).duration_s).toBe(0);
    for (const bad of [61, -1, 12.5]) {
      expect(() => storySegmentSchema.parse({ ...valid, duration_s: bad })).toThrow();
    }
  });
});

const baseInsert = {
  author_id: valid.author_id,
  kind: 'video',
  storage_path: '22222222/seg2.mp4',
};

describe('storySegmentInsertSchema', () => {
  it('defaults the optional fields', () => {
    const parsed = storySegmentInsertSchema.parse(baseInsert);
    expect(parsed).toMatchObject({ is_step: false, duration_s: null, caption: null });
  });

  // The insert re-declares duration_s rather than picking it, so the row's bound proves nothing
  // about this one — they are two separate constraints that happen to read alike.
  it('bounds duration_s on the insert too', () => {
    expect(storySegmentInsertSchema.parse({ ...baseInsert, duration_s: 60 }).duration_s).toBe(60);
    expect(storySegmentInsertSchema.parse({ ...baseInsert, duration_s: 0 }).duration_s).toBe(0);
    for (const bad of [61, -1, 12.5]) {
      expect(() => storySegmentInsertSchema.parse({ ...baseInsert, duration_s: bad })).toThrow();
    }
  });
});

describe('storySegmentInsertSchema shape', () => {
  // Picked from the row (rules/schemas.md); the literal key list is what a flipped pick flag
  // fails, where "defaults the optional fields" above passes for whatever the pick kept.
  it('carries exactly author, kind, path and the three defaulted fields', () => {
    expect(Object.keys(storySegmentInsertSchema.shape).sort()).toEqual([
      'author_id',
      'caption',
      'duration_s',
      'is_step',
      'kind',
      'storage_path',
    ]);
  });

  it('requires author_id, kind and storage_path', () => {
    for (const key of ['author_id', 'kind', 'storage_path'] as const) {
      const { [key]: _dropped, ...without } = baseInsert;
      expect(storySegmentInsertSchema.safeParse(without).success).toBe(false);
    }
  });
});
