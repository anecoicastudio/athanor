import { describe, expect, it } from 'vitest';
import { REPORT_CATEGORIES, reportInput, reportSchema } from './report.ts';

const TARGET = '33333333-3333-3333-3333-333333333333';

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

  // Both carry a target: since #611 a targetless 'post' is rejected on its own, so without one
  // these would throw for the wrong reason and prove nothing about the category or the note.
  it('rejects an unknown category and an over-long note', () => {
    expect(() =>
      reportInput.parse({ targetType: 'post', targetId: TARGET, category: 'nope' }),
    ).toThrow();
    expect(() =>
      reportInput.parse({
        targetType: 'post',
        targetId: TARGET,
        category: 'other',
        note: 'x'.repeat(2001),
      }),
    ).toThrow();
  });

  // #611 — a report points at something unless it is about behaviour in general. The rule is
  // one-directional on purpose: 'behavior' MAY carry a target (the staging seed files one), the
  // other three MUST. Mirrors reports_target_required_unless_behavior (20260904152300).
  describe('targetId is required unless targetType is behavior (#611)', () => {
    it.each(['person', 'post', 'message'] as const)('rejects a null target on %s', (targetType) => {
      const r = reportInput.safeParse({ targetType, targetId: null, category: 'spam' });
      expect(r.success).toBe(false);
      expect(r.error?.issues).toHaveLength(1);
      expect(r.error?.issues[0]?.path).toEqual(['targetId']);
      expect(r.error?.issues[0]?.code).toBe('custom');
      expect(r.error?.issues[0]?.message).toBe('target_required');
    });

    it.each(['person', 'post', 'message'] as const)(
      'rejects a missing target on %s',
      (targetType) => {
        const r = reportInput.safeParse({ targetType, category: 'spam' });
        expect(r.success).toBe(false);
        expect(r.error?.issues[0]?.path).toEqual(['targetId']);
        expect(r.error?.issues[0]?.message).toBe('target_required');
      },
    );

    it.each(['person', 'post', 'message'] as const)('accepts a uuid target on %s', (targetType) => {
      const parsed = reportInput.parse({ targetType, targetId: TARGET, category: 'spam' });
      expect(parsed.targetId).toBe(TARGET);
    });

    it('accepts behavior with a null target, with no target, and with a uuid target', () => {
      expect(
        reportInput.parse({ targetType: 'behavior', targetId: null, category: 'other' }).targetId,
      ).toBeNull();
      expect(
        reportInput.parse({ targetType: 'behavior', category: 'other' }).targetId,
      ).toBeUndefined();
      expect(
        reportInput.parse({ targetType: 'behavior', targetId: TARGET, category: 'other' }).targetId,
      ).toBe(TARGET);
    });

    it('rejects a non-uuid target on every type, behavior included', () => {
      for (const targetType of ['person', 'post', 'message', 'behavior'] as const) {
        const r = reportInput.safeParse({ targetType, targetId: 'not-a-uuid', category: 'spam' });
        expect(r.success, targetType).toBe(false);
        expect(r.error?.issues[0]?.path).toEqual(['targetId']);
        expect(r.error?.issues[0]?.code).toBe('invalid_string');
      }
    });
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
