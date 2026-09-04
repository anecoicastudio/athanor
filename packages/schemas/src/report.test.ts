import { describe, expect, it } from 'vitest';
import { REPORT_CATEGORIES, reportInput, reportSchema } from './report.ts';

describe('report schemas', () => {
  it('parses a valid raw report row (own, status open)', () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      reporter_id: '22222222-2222-2222-2222-222222222222',
      target_type: 'person' as const,
      target_id: '33333333-3333-3333-3333-333333333333',
      category: 'spam' as const,
      note: null,
      status: 'open' as const,
      created_at: '2026-06-20T00:00:00Z',
    };
    expect(reportSchema.parse(row)).toEqual(row);
  });

  it('accepts a behavior report with a null target and trims an optional note', () => {
    const parsed = reportInput.parse({
      targetType: 'behavior',
      targetId: null,
      category: 'harassment',
      note: '  unwanted DMs  ',
    });
    expect(parsed.targetId).toBeNull();
    expect(parsed.note).toBe('unwanted DMs');
  });

  it('rejects an unknown category and an over-long note', () => {
    expect(() => reportInput.parse({ targetType: 'post', category: 'nope' })).toThrow();
    expect(() =>
      reportInput.parse({ targetType: 'post', category: 'other', note: 'x'.repeat(2001) }),
    ).toThrow();
  });

  it('exposes the seven PRD §4.13 reason categories', () => {
    expect(REPORT_CATEGORIES).toEqual([
      'selling',
      'income',
      'mlm',
      'harassment',
      'spam',
      'impersonation',
      'other',
    ]);
  });
});
