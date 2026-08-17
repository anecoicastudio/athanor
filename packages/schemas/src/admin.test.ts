import { describe, it, expect } from 'vitest';
import { AUDIT_LOG_ACTIONS, auditLogRow, resolveReportInput } from './admin';

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

// #219 — audit_log holds two shapes now; the mirror must accept both and nothing else.
describe('auditLogRow', () => {
  const base = {
    id: crypto.randomUUID(),
    penalty_points: null,
    reason: null,
    created_at: new Date().toISOString(),
  };
  const moderation = {
    ...base,
    report_id: crypto.randomUUID(),
    actor_id: crypto.randomUUID(),
    action: 'dismiss',
    edition_id: null,
    candidacy_id: null,
  };
  const fund = {
    ...base,
    report_id: null,
    actor_id: null,
    action: 'declare_winner',
    edition_id: crypto.randomUUID(),
    candidacy_id: crypto.randomUUID(),
  };

  // #392 — the literal list, spelled out rather than looped over the constant: a loop
  // asserts only that the array equals itself, so deleting a member leaves it green.
  // The order is audit_log_action_check's own (20260816110227_fund_tranche_gate.sql:43-48);
  // audit-log-actions.mirror.test.ts holds this against the migration itself.
  it('admits exactly the actions audit_log_action_check admits', () => {
    expect(AUDIT_LOG_ACTIONS).toEqual([
      'dismiss',
      'warn',
      'penalty',
      'suspend',
      'ban',
      'declare_winner',
      'screen_start',
      'screen_pass',
      'screen_reject',
      'screen_reopen',
      'announce',
      'void_cycle',
      'winner_confirm',
      'winner_decline',
      'close_cycle',
      'rollover_cycle',
      'publish_plan',
      'verify_phase',
    ]);
  });

  it('accepts a moderation row (report + actor set, no fund columns)', () => {
    const v = auditLogRow.parse(moderation);
    expect(v.action).toBe('dismiss');
  });
  it('accepts a declare_winner row (edition set, no report, no user actor)', () => {
    const v = auditLogRow.parse(fund);
    expect(v.action).toBe('declare_winner');
  });
  it('accepts every fund action in the same shape', () => {
    // Each is in audit_log_fund_shape's list, so each must clear the refinement — a
    // member that only ever appears inside the enum proves nothing about the shape rule.
    for (const action of ['verify_phase', 'publish_plan', 'rollover_cycle'] as const) {
      expect(auditLogRow.parse({ ...fund, action }).action).toBe(action);
    }
  });
  it('rejects an unknown action', () => {
    expect(() => auditLogRow.parse({ ...fund, action: 'declare_realized' })).toThrow();
  });

  // #392 — audit_log_fund_shape, mirrored. Each rejection is one conjunct of the SQL;
  // together with the moderation cases below they pin the whole implication, so neither
  // the guard nor any single column check can be dropped without a red test.
  it('rejects a fund row without an edition', () => {
    const r = auditLogRow.safeParse({ ...fund, edition_id: null });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['edition_id']);
    expect(r.error?.issues[0]?.message).toBe(
      'a fund action carries an edition and neither a report nor penalty points',
    );
  });
  it('rejects a fund row that also carries a report', () => {
    expect(auditLogRow.safeParse({ ...fund, report_id: crypto.randomUUID() }).success).toBe(false);
  });
  it('rejects a fund row that also carries penalty points', () => {
    expect(auditLogRow.safeParse({ ...fund, penalty_points: -200 }).success).toBe(false);
  });
  // The other half of the implication: the shape rule binds fund actions ONLY. A penalty
  // row is exactly what it would wrongly reject — report set, points set, no edition.
  it('leaves moderation rows alone — report and penalty points and no edition', () => {
    const v = auditLogRow.parse({ ...moderation, action: 'penalty', penalty_points: -200 });
    expect(v.penalty_points).toBe(-200);
  });
  it('accepts a moderation row with an edition set', () => {
    // Not a shape the writer produces, but the SQL does not forbid it either, and a
    // refinement that rejected it would be stricter than the constraint it mirrors.
    expect(auditLogRow.safeParse({ ...moderation, edition_id: crypto.randomUUID() }).success).toBe(
      true,
    );
  });
});
