import { describe, expect, test } from 'vitest';
import {
  milestoneInsertSchema,
  milestoneStatusSchema,
  milestoneStatusUpdateSchema,
} from './milestone';

const DREAM_ID = '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111';

describe('milestoneInsertSchema', () => {
  test('trims and accepts a 1–200 char body', () => {
    expect(milestoneInsertSchema.parse({ dream_id: DREAM_ID, body: '  Un mentor  ' })).toEqual({
      dream_id: DREAM_ID,
      body: 'Un mentor',
    });
  });

  test('rejects a blank / whitespace-only body', () => {
    expect(milestoneInsertSchema.safeParse({ dream_id: DREAM_ID, body: '   ' }).success).toBe(
      false,
    );
    expect(milestoneInsertSchema.safeParse({ dream_id: DREAM_ID, body: '' }).success).toBe(false);
  });

  test('accepts exactly 200 chars and rejects 201', () => {
    expect(
      milestoneInsertSchema.safeParse({ dream_id: DREAM_ID, body: 'a'.repeat(200) }).success,
    ).toBe(true);
    expect(
      milestoneInsertSchema.safeParse({ dream_id: DREAM_ID, body: 'a'.repeat(201) }).success,
    ).toBe(false);
  });

  test('rejects a non-uuid dream_id', () => {
    expect(milestoneInsertSchema.safeParse({ dream_id: 'nope', body: 'Un mentor' }).success).toBe(
      false,
    );
  });
});

describe('milestoneStatusSchema', () => {
  test('accepts the three states, rejects others', () => {
    for (const s of ['open', 'in_progress', 'done']) {
      expect(milestoneStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(milestoneStatusSchema.safeParse('accepted').success).toBe(false);
  });

  test('milestoneStatusUpdateSchema picks status only', () => {
    expect(milestoneStatusUpdateSchema.parse({ status: 'done' })).toEqual({ status: 'done' });
  });
});
