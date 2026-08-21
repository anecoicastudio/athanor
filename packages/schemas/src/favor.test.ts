import { describe, expect, test } from 'vitest';
import { favorInsertSchema, favorNeedSchema, favorOfferSchema } from './favor';

describe('favorOfferSchema', () => {
  test('parses a valid favor row', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      actor_id: '22222222-2222-2222-2222-222222222222',
      target_id: '33333333-3333-3333-3333-333333333333',
      need: 'Un parere sull’identità visiva',
      need_milestone_id: '44444444-4444-4444-4444-444444444444',
      created_at: '2026-06-15T00:00:00Z',
      updated_at: '2026-06-15T00:00:00Z',
      deleted_at: null,
    };
    expect(favorOfferSchema.parse(row)).toMatchObject({ need: 'Un parere sull’identità visiva' });
  });

  test('rejects an empty/whitespace need', () => {
    expect(() =>
      favorInsertSchema.parse({
        target_id: '33333333-3333-3333-3333-333333333333',
        need: '   ',
        need_milestone_id: null,
      }),
    ).toThrow();
  });

  test('rejects a need over 280 chars', () => {
    expect(() =>
      favorInsertSchema.parse({
        target_id: '33333333-3333-3333-3333-333333333333',
        need: 'x'.repeat(281),
        need_milestone_id: null,
      }),
    ).toThrow();
  });
});

describe('favorNeedSchema', () => {
  test('parses a favor_needs view row (handle may be null)', () => {
    const row = {
      need_milestone_id: '44444444-4444-4444-4444-444444444444',
      need: 'Un mentor',
      need_created_at: '2026-06-15T00:00:00Z',
      target_id: '33333333-3333-3333-3333-333333333333',
      target_handle: null,
      target_display_name: null,
      target_avatar_path: null,
    };
    expect(favorNeedSchema.parse(row)).toMatchObject({ need: 'Un mentor', target_handle: null });
  });
});

describe('favorInsertSchema shape', () => {
  test('carries exactly target, need and the milestone it answers — actor_id comes from auth', () => {
    expect(Object.keys(favorInsertSchema.shape).sort()).toEqual([
      'need',
      'need_milestone_id',
      'target_id',
    ]);
  });

  test('requires target_id and need_milestone_id', () => {
    const base = {
      target_id: '33333333-3333-3333-3333-333333333333',
      need: 'Un parere',
      need_milestone_id: null,
    };
    for (const key of ['target_id', 'need_milestone_id'] as const) {
      const { [key]: _dropped, ...without } = base;
      expect(favorInsertSchema.safeParse(without).success).toBe(false);
    }
  });
});
