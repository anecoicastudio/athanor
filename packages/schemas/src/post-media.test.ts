import { describe, expect, it } from 'vitest';
import { mediaKindSchema, postMediaInsertSchema, postMediaSchema } from './post-media';

const POST = '00000000-0000-0000-0000-000000000002';

const imageRow = {
  id: '00000000-0000-0000-0000-000000000001',
  post_id: POST,
  kind: 'image',
  storage_path: 'uid/post/0.jpg',
  thumb_path: null,
  duration_s: null,
  width: 800,
  height: 600,
  position: 0,
  created_at: '2026-06-14T00:00:00.000Z',
  updated_at: '2026-06-14T00:00:00.000Z',
};

const baseInsert = { post_id: POST, kind: 'image', storage_path: 'uid/post/0.jpg', position: 0 };

describe('postMediaSchema', () => {
  it('parses an image row unchanged', () => {
    expect(postMediaSchema.parse(imageRow)).toEqual(imageRow);
  });

  it('accepts every kind the media_kind enum has, and only those', () => {
    expect(mediaKindSchema.options).toEqual(['image', 'video', 'audio']);
    for (const kind of mediaKindSchema.options) {
      expect(postMediaSchema.parse({ ...imageRow, kind }).kind).toBe(kind);
    }
    for (const kind of ['gif', 'Image', '']) {
      expect(() => postMediaSchema.parse({ ...imageRow, kind })).toThrow();
    }
  });

  it('bounds duration_s to ≤1200s, integer, non-negative (mirrors the post_media CHECK)', () => {
    const audio = { ...imageRow, kind: 'audio', storage_path: 'uid/post/0.m4a' };
    expect(postMediaSchema.parse({ ...audio, duration_s: 1200 }).duration_s).toBe(1200);
    expect(postMediaSchema.parse({ ...audio, duration_s: 0 }).duration_s).toBe(0);
    for (const bad of [1201, -1, 90.5]) {
      expect(() => postMediaSchema.parse({ ...audio, duration_s: bad })).toThrow();
    }
  });

  it('keeps position a non-negative integer — it is the carousel order, not a flag', () => {
    expect(postMediaSchema.parse({ ...imageRow, position: 3 }).position).toBe(3);
    for (const bad of [-1, 1.5]) {
      expect(() => postMediaSchema.parse({ ...imageRow, position: bad })).toThrow();
    }
  });

  it('rejects an empty storage_path and non-positive dimensions', () => {
    expect(() => postMediaSchema.parse({ ...imageRow, storage_path: '' })).toThrow();
    expect(() => postMediaSchema.parse({ ...imageRow, width: 0 })).toThrow();
    expect(() => postMediaSchema.parse({ ...imageRow, height: -1 })).toThrow();
  });

  it('requires the dimension and duration keys — a row may hold null, never nothing', () => {
    const { duration_s: _d, ...withoutDuration } = imageRow;
    const { width: _w, ...withoutWidth } = imageRow;
    expect(() => postMediaSchema.parse(withoutDuration)).toThrow();
    expect(() => postMediaSchema.parse(withoutWidth)).toThrow();
  });
});

describe('postMediaInsertSchema', () => {
  it('defaults thumb, duration and dimensions to null, so a minimal insert is a complete payload', () => {
    expect(postMediaInsertSchema.parse(baseInsert)).toEqual({
      ...baseInsert,
      thumb_path: null,
      duration_s: null,
      width: null,
      height: null,
    });
  });

  it('carries a video upload through with duration and dimensions', () => {
    expect(
      postMediaInsertSchema.parse({
        ...baseInsert,
        kind: 'video',
        storage_path: 'uid/post/0.mp4',
        duration_s: 45,
        width: 1920,
        height: 1080,
      }),
    ).toMatchObject({ kind: 'video', duration_s: 45, width: 1920, height: 1080 });
  });

  it('drops nothing from the row shape it was picked from', () => {
    expect(Object.keys(postMediaInsertSchema.shape).sort()).toEqual([
      'duration_s',
      'height',
      'kind',
      'position',
      'post_id',
      'storage_path',
      'thumb_path',
      'width',
    ]);
  });

  it('rejects an unknown kind', () => {
    expect(() => postMediaInsertSchema.parse({ ...baseInsert, kind: 'gif' })).toThrow();
  });

  it('rejects an insert with no post_id, path or position', () => {
    const { post_id: _p, ...withoutPost } = baseInsert;
    const { storage_path: _s, ...withoutPath } = baseInsert;
    const { position: _pos, ...withoutPosition } = baseInsert;
    expect(() => postMediaInsertSchema.parse(withoutPost)).toThrow();
    expect(() => postMediaInsertSchema.parse(withoutPath)).toThrow();
    expect(() => postMediaInsertSchema.parse(withoutPosition)).toThrow();
  });
});
