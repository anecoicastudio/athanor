import { describe, it, expect } from 'vitest';
import {
  AUDIT_LOG_ACTIONS,
  adminFundEditionRow,
  adminReportDetail,
  adminReportedMessage,
  adminReportHandlesRow,
  adminReportRow,
  auditLogRow,
  resolveReportInput,
} from './admin.ts';
import { REPORT_TARGET_TYPES } from './report.ts';

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

describe('resolveReportInput — refine routing', () => {
  const base = { reportId: crypto.randomUUID(), resolution: 'x' };

  // The `path` on each refine is the field a form attaches the error to. The severity-required
  // path is pinned above; the other four were blankable unseen, and a refine that reports
  // against the wrong field is one a form renders nowhere.
  it('routes each refine failure to the field it is about', () => {
    const actionOnDismiss = resolveReportInput.safeParse({
      ...base,
      verdict: 'dismiss',
      action: 'ban',
    });
    expect(actionOnDismiss.success).toBe(false);
    expect(actionOnDismiss.error?.issues[0]?.path).toEqual(['action']);

    const severityOnWarn = resolveReportInput.safeParse({
      ...base,
      verdict: 'uphold',
      action: 'warn',
      severity: 'low',
    });
    expect(severityOnWarn.success).toBe(false);
    expect(severityOnWarn.error?.issues[0]?.path).toEqual(['severity']);

    const suspendWithoutDays = resolveReportInput.safeParse({
      ...base,
      verdict: 'uphold',
      action: 'suspend',
    });
    expect(suspendWithoutDays.success).toBe(false);
    expect(suspendWithoutDays.error?.issues[0]?.path).toEqual(['suspendDays']);

    const daysWithoutSuspend = resolveReportInput.safeParse({
      ...base,
      verdict: 'uphold',
      action: 'ban',
      suspendDays: 7,
    });
    expect(daysWithoutSuspend.success).toBe(false);
    expect(daysWithoutSuspend.error?.issues[0]?.path).toEqual(['suspendDays']);
  });

  // severity prices the Aura deduction (core maps it, rule #10), and a dismiss deducts nothing.
  // Only the uphold arm was exercised before, so the `verdict === 'uphold'` guard could have
  // been a constant `true` and a priced dismiss would have parsed.
  it('rejects a severity on a dismiss — nothing is priced when nothing is upheld', () => {
    const r = resolveReportInput.safeParse({ ...base, verdict: 'dismiss', severity: 'high' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['severity']);
  });
});

describe('admin read shapes', () => {
  it('a queue row carries exactly what the queue renders', () => {
    expect(Object.keys(adminReportRow.shape)).toEqual([
      'id',
      'target_type',
      'target_id',
      'category',
      'status',
      'created_at',
      'reporter_handle',
    ]);
  });

  // #664: the channel that replaces the panel's profiles reads projects two handles and nothing
  // else about either party — no id, no avatar, no display name. The key list IS the privacy
  // claim, so it is pinned exactly, and every field's nullability is pinned beside it.
  it('a report-handles row is two handles keyed by report id, and nothing else', () => {
    expect(Object.keys(adminReportHandlesRow.shape)).toEqual([
      'report_id',
      'reporter_handle',
      'subject_handle',
    ]);
    const rid = crypto.randomUUID();
    expect(
      adminReportHandlesRow.parse({
        report_id: rid,
        reporter_handle: 'elena',
        subject_handle: null,
      }),
    ).toEqual({ report_id: rid, reporter_handle: 'elena', subject_handle: null });
    expect(
      adminReportHandlesRow.safeParse({
        report_id: rid,
        reporter_handle: null,
        subject_handle: 'marco',
      }).success,
    ).toBe(true);
    // A key the projection does not carry is refused as a wider shape would be typed as valid.
    expect(
      adminReportHandlesRow.strict().safeParse({
        report_id: rid,
        reporter_handle: 'elena',
        subject_handle: null,
        reporter_id: rid,
      }).success,
    ).toBe(false);
    expect(
      adminReportHandlesRow.safeParse({
        report_id: 'r1',
        reporter_handle: 'elena',
        subject_handle: null,
      }).success,
    ).toBe(false);
    expect(
      adminReportHandlesRow.safeParse({ report_id: rid, reporter_handle: 'elena' }).success,
    ).toBe(false);
    expect(
      adminReportHandlesRow.safeParse({ report_id: rid, reporter_handle: 7, subject_handle: null })
        .success,
    ).toBe(false);
  });

  // Not a hand-written list any more (#574): the queue's enum IS `reportTargetType`, so this
  // asserts the DERIVATION rather than a second copy that has to be remembered. Comparing
  // against REPORT_TARGET_TYPES is what makes it fail if the two ever come apart again — a
  // literal here would go on passing while the reporter side widened underneath it, which is
  // precisely how 'message' came to be admitted by the CHECK and refused by the panel.
  it('target_type is the reports vocabulary itself, derived — and nothing else', () => {
    expect(adminReportRow.shape.target_type.options).toEqual([...REPORT_TARGET_TYPES]);
    expect(adminReportRow.shape.target_type.options).toContain('message');
    for (const bad of ['comment', 'event', 'thread', '']) {
      expect(adminReportRow.shape.target_type.safeParse(bad).success).toBe(false);
    }
  });

  it('the detail is the queue row plus note, resolution, target handle, the audit trail with its withheld count, and the reported message with its state', () => {
    expect(Object.keys(adminReportDetail.shape)).toEqual([
      'id',
      'target_type',
      'target_id',
      'category',
      'status',
      'created_at',
      'reporter_handle',
      'note',
      'resolution',
      'target_handle',
      'audit',
      'auditExcluded',
      'handlesExcluded',
      'reportedMessage',
      'reportedMessageState',
    ]);
  });

  // A withheld count is a whole number of rows, never negative (#664 — and the same holds for
  // auditExcluded beside it, asserted here so the .int()/.nonnegative() arms have a killer).
  it('withheld counts are non-negative integers', () => {
    for (const field of ['handlesExcluded', 'auditExcluded'] as const) {
      const s = adminReportDetail.shape[field];
      expect(s.safeParse(0).success).toBe(true);
      expect(s.safeParse(3).success).toBe(true);
      expect(s.safeParse(-1).success).toBe(false);
      expect(s.safeParse(1.5).success).toBe(false);
      expect(s.safeParse('1').success).toBe(false);
    }
  });

  // The four ways a null can happen, named. A single null would present an RLS regression on
  // the evidence policy as an erasure — the one dressing in which nobody investigates it.
  it('names why the reported message is absent rather than collapsing four facts into null', () => {
    expect(adminReportDetail.shape.reportedMessageState.options).toEqual([
      'notApplicable',
      'present',
      'absent',
      'unreadable',
      'withheld',
    ]);
    expect(adminReportDetail.shape.reportedMessageState.safeParse('gone').success).toBe(false);
  });

  // The evidence shape is the privacy boundary written down (#574 / #97's ruling). A
  // conversation id here would be the affordance that turns "the reported message" into "the
  // thread it came from" — so the absence is asserted, not merely arranged.
  it('the reported message carries no conversation id and no thread handle', () => {
    expect(Object.keys(adminReportedMessage.shape)).toEqual([
      'id',
      'body',
      'media_url',
      'created_at',
      'sender_handle',
    ]);
    expect(Object.keys(adminReportedMessage.shape)).not.toContain('conversation_id');
  });

  it('accepts an image-only reported message and a text-only one', () => {
    const base = {
      id: '00000000-0000-0000-0000-0000000000a1',
      created_at: '2026-08-31T10:00:00Z',
      sender_handle: 'marco',
    };
    expect(
      adminReportedMessage.safeParse({ ...base, body: null, media_url: 'a/b/c.jpg' }).success,
    ).toBe(true);
    expect(adminReportedMessage.safeParse({ ...base, body: 'ciao', media_url: null }).success).toBe(
      true,
    );
  });
});

// #432 — the fund-audit index row is a projection of the cycle, not a second declaration of
// it. The six pick flags are what keep it one: a flipped flag drops a column the index names,
// orders by or links on, and a parse of a full cycle row would still succeed.
describe('adminFundEditionRow', () => {
  const cycle = {
    id: '00000000-0000-0000-0000-0000000000ed',
    phase: 'realization',
    target_at: '2026-12-31T00:00:00+00:00',
    created_at: '2026-06-01T00:00:00+00:00',
    closure_reason: null,
    winner_candidacy_id: '00000000-0000-0000-0000-0000000000ca',
  };

  it('picks exactly the six index columns from the cycle, in index order', () => {
    expect(Object.keys(adminFundEditionRow.shape)).toEqual([
      'id',
      'phase',
      'target_at',
      'created_at',
      'closure_reason',
      'winner_candidacy_id',
    ]);
  });

  it('parses an index row and strips the money columns the index never shows', () => {
    const parsed = adminFundEditionRow.parse({
      ...cycle,
      goal_cents: 500000,
      confirmed_pool_cents: 12000,
    });
    expect(parsed).toEqual(cycle);
  });

  it('keeps the cycle’s own constraints — phase is the fund vocabulary, ids are uuids', () => {
    expect(adminFundEditionRow.safeParse({ ...cycle, phase: 'archived' }).success).toBe(false);
    expect(adminFundEditionRow.safeParse({ ...cycle, winner_candidacy_id: 'cand-1' }).success).toBe(
      false,
    );
  });
});
