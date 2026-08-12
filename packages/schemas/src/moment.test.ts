import { describe, expect, it } from 'vitest';
import { momentInsertSchema, momentSchema } from './moment';

const OWNER = '00000000-0000-0000-0000-000000000001';

const photoRow = {
  id: '00000000-0000-0000-0000-0000000000a1',
  owner_id: OWNER,
  kind: 'photo',
  media_path: 'uid/m.jpg',
  thumb_path: null,
  caption: 'ok',
  duration_s: null,
  width: 1080,
  height: 1350,
  created_at: '2026-06-14T00:00:00.000Z',
  updated_at: '2026-06-14T00:00:00.000Z',
  deleted_at: null,
};

describe('momentSchema', () => {
  it('parses a photo row unchanged', () => {
    expect(momentSchema.parse(photoRow)).toEqual(photoRow);
  });

  it('parses a video row with a duration and no poster yet (#131)', () => {
    // thumb_path stays null until a poster frame is extracted — the row is valid without it.
    const videoRow = { ...photoRow, kind: 'video', media_path: 'uid/m.mp4', duration_s: 30 };
    const m = momentSchema.parse(videoRow);
    expect(m.kind).toBe('video');
    expect(m.duration_s).toBe(30);
    expect(m.thumb_path).toBeNull();
  });

  it('accepts a poster path once one exists', () => {
    const m = momentSchema.parse({ ...photoRow, kind: 'video', thumb_path: 'uid/m-thumb.jpg' });
    expect(m.thumb_path).toBe('uid/m-thumb.jpg');
  });

  it('rejects a kind outside photo/video', () => {
    for (const kind of ['audio', 'story', '']) {
      expect(() => momentSchema.parse({ ...photoRow, kind })).toThrow();
    }
  });

  it('bounds duration_s to a ≤60s clip, integer, non-negative (mirrors the moments CHECK)', () => {
    expect(momentSchema.parse({ ...photoRow, duration_s: 60 }).duration_s).toBe(60);
    expect(momentSchema.parse({ ...photoRow, duration_s: 0 }).duration_s).toBe(0);
    for (const bad of [61, -1, 12.5]) {
      expect(() => momentSchema.parse({ ...photoRow, duration_s: bad })).toThrow();
    }
  });

  it('rejects an empty media_path and non-positive dimensions', () => {
    expect(() => momentSchema.parse({ ...photoRow, media_path: '' })).toThrow();
    expect(() => momentSchema.parse({ ...photoRow, width: 0 })).toThrow();
    expect(() => momentSchema.parse({ ...photoRow, height: -1 })).toThrow();
  });

  it('keeps deleted_at nullable — soft delete is an update, not a row shape change', () => {
    expect(
      momentSchema.parse({ ...photoRow, deleted_at: '2026-06-15T00:00:00.000Z' }).deleted_at,
    ).toBe('2026-06-15T00:00:00.000Z');
  });
});

const baseInsert = { owner_id: OWNER, kind: 'photo', media_path: 'uid/m.jpg' };

describe('momentInsertSchema', () => {
  it('defaults every optional column, so a minimal insert is a complete row payload', () => {
    expect(
      momentInsertSchema.parse({ owner_id: OWNER, kind: 'photo', media_path: 'uid/m.jpg' }),
    ).toEqual({
      owner_id: OWNER,
      kind: 'photo',
      media_path: 'uid/m.jpg',
      thumb_path: null,
      caption: null,
      duration_s: null,
      width: null,
      height: null,
    });
  });

  it('carries a video upload through with duration and poster', () => {
    const insert = momentInsertSchema.parse({
      owner_id: OWNER,
      kind: 'video',
      media_path: 'uid/m.mp4',
      thumb_path: 'uid/m-thumb.jpg',
      duration_s: 12,
      width: 720,
      height: 1280,
    });
    expect(insert).toMatchObject({ kind: 'video', duration_s: 12, thumb_path: 'uid/m-thumb.jpg' });
  });

  it('trims the caption before measuring it', () => {
    expect(momentInsertSchema.parse({ ...baseInsert, caption: '  ok  ' }).caption).toBe('ok');
  });

  it('rejects a caption over 280 chars', () => {
    expect(() => momentInsertSchema.parse({ ...baseInsert, caption: 'x'.repeat(281) })).toThrow();
    expect(
      momentInsertSchema.parse({ ...baseInsert, caption: 'x'.repeat(280) }).caption,
    ).toHaveLength(280);
  });

  it('rejects an insert with no owner, kind or path', () => {
    expect(() => momentInsertSchema.parse({ kind: 'photo', media_path: 'uid/m.jpg' })).toThrow();
    expect(() => momentInsertSchema.parse({ owner_id: OWNER, media_path: 'uid/m.jpg' })).toThrow();
    expect(() => momentInsertSchema.parse({ owner_id: OWNER, kind: 'photo' })).toThrow();
  });
});
