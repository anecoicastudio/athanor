import { describe, it, expect } from 'vitest';
import { resolveReportInput } from './admin';

describe('resolveReportInput', () => {
  it('accepts a dismiss verdict without severity', () => {
    const v = resolveReportInput.parse({
      reportId: crypto.randomUUID(),
      verdict: 'dismiss',
      resolution: 'spam, archived',
    });
    expect(v.verdict).toBe('dismiss');
  });
  it('requires severity when upholding', () => {
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'uphold',
        resolution: 'x',
      }),
    ).toThrow();
  });
  // Only the refine's REJECT arm was covered, so the predicate could have been a constant
  // `false` — rejecting every uphold — and this suite would still be green. That is the path
  // that mints report_upheld (−200, rule #1): if it can never be submitted the penalty can
  // never be applied, and no test would say so.
  it('accepts an uphold that carries a severity', () => {
    const v = resolveReportInput.parse({
      reportId: crypto.randomUUID(),
      verdict: 'uphold',
      resolution: 'selling in a dream thread',
      severity: 'medium',
    });
    expect(v).toMatchObject({ verdict: 'uphold', severity: 'medium' });
  });
  // The refine's `path` is what a form keys its field-level error off. Nothing consumes it
  // today, so blanking it is invisible — pin it before something does.
  it('reports the missing severity against the severity field', () => {
    const r = resolveReportInput.safeParse({
      reportId: crypto.randomUUID(),
      verdict: 'uphold',
      resolution: 'x',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['severity']);
  });
  it('rejects an over-long resolution', () => {
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'dismiss',
        resolution: 'x'.repeat(2001),
      }),
    ).toThrow();
  });

  // #106 — the four PRD §4.13 actions on an uphold.
  it('accepts warn and ban without severity or days', () => {
    for (const action of ['warn', 'ban'] as const) {
      const v = resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'uphold',
        action,
        resolution: 'x',
      });
      expect(v.action).toBe(action);
    }
  });
  it('suspend requires suspendDays, and suspendDays requires suspend', () => {
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'uphold',
        action: 'suspend',
        resolution: 'x',
      }),
    ).toThrow();
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'uphold',
        action: 'ban',
        resolution: 'x',
        suspendDays: 7,
      }),
    ).toThrow();
    const v = resolveReportInput.parse({
      reportId: crypto.randomUUID(),
      verdict: 'uphold',
      action: 'suspend',
      resolution: 'x',
      suspendDays: 7,
    });
    expect(v.suspendDays).toBe(7);
  });
  it('rejects an action on a dismiss and severity on a non-penalty action', () => {
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'dismiss',
        action: 'ban',
        resolution: 'x',
      }),
    ).toThrow();
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'uphold',
        action: 'warn',
        resolution: 'x',
        severity: 'low',
      }),
    ).toThrow();
  });
  it('an explicit penalty action still demands severity — same contract as the bare uphold', () => {
    expect(() =>
      resolveReportInput.parse({
        reportId: crypto.randomUUID(),
        verdict: 'uphold',
        action: 'penalty',
        resolution: 'x',
      }),
    ).toThrow();
  });
});
