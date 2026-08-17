import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DreamCandidacy } from '@athanor/schemas';
import {
  TOTAL_STEPS,
  WIZARD_STEPS,
  type WizardDraft,
  type WizardValues,
  budgetPair,
  canAdvance,
  hasStandingVideo,
  prefillValues,
  stepAt,
  stepBlocker,
  submitBlockers,
} from './candidacy-wizard';

/**
 * #385 — the seven wizard steps, asserted the way `fund-disclosure.test.ts` asserts the
 * sixteen facts: every key BY NAME, never a count. A count passes on seven wrong steps.
 *
 * The screen half is a source audit for the same reason as there: vitest runs
 * `environment: 'node'` over `*.test.ts`, so nothing that renders is collectable, and the
 * proof that the screen renders THIS array has to be structural.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const screen = () => readFileSync(`${SRC}app/(modal)/candidacy.tsx`, 'utf8');

const VALUES: WizardValues = {
  story: 'la mia storia',
  goal: 'il mio obiettivo',
  impact: 'il mio impatto',
  plan: 'il mio piano',
  budgetEuro: '8000',
  minViableEuro: '5000',
  skills: [],
  category: null,
  linkDream: false,
};

const draftWith = (over: Partial<WizardDraft> = {}): WizardDraft => ({
  ...VALUES,
  hasVideo: true,
  ...over,
});

const CANDIDACY: DreamCandidacy = {
  id: '11111111-1111-4111-8111-111111111111',
  edition_id: '22222222-2222-4222-8222-222222222222',
  profile_id: '33333333-3333-4333-8333-333333333333',
  story: 'storia salvata',
  goal: 'obiettivo salvato',
  impact: 'impatto salvato',
  video_url: 'uid/candidacy.mp4',
  thumb_path: 'uid/candidacy-thumb.jpg',
  plan: 'piano salvato',
  status: 'submitted',
  city: 'Roma',
  category: 'artistic',
  budget_cents: 800_000,
  min_viable_cents: 500_000,
  skills_needed: ['design', 'video'],
  dream_id: '44444444-4444-4444-8444-444444444444',
  rejection_reasons: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  deleted_at: null,
};

describe('the seven steps (07 §3.4, #226)', () => {
  it('are the spec step-for-step, each catalog key by name', () => {
    // Deep equality on NAMES: reordering the wizard, renaming a catalog key or padding with
    // an eighth step all fail loudly here. The maxLengths mirror dreamCandidacySchema's
    // `z.string().max(…)` — a form that lets more through than the schema accepts fails at
    // the boundary instead of at the keyboard.
    expect(
      WIZARD_STEPS.map((step) => ({
        key: step.key,
        label: step.label,
        question: step.question,
        sub: step.sub,
        input: step.input ? { ...step.input } : null,
      })),
    ).toEqual([
      {
        key: 'story',
        label: 'candidacy.step1.label',
        question: 'candidacy.step1.q',
        sub: 'candidacy.step1.sub',
        input: { field: 'story', placeholder: 'candidacy.step1.placeholder', maxLength: 4000 },
      },
      {
        key: 'goal',
        label: 'candidacy.step2.label',
        question: 'candidacy.step2.q',
        sub: 'candidacy.step2.sub',
        input: { field: 'goal', placeholder: 'candidacy.step2.placeholder', maxLength: 2000 },
      },
      {
        key: 'impact',
        label: 'candidacy.step3.label',
        question: 'candidacy.step3.q',
        sub: 'candidacy.step3.sub',
        input: { field: 'impact', placeholder: 'candidacy.step3.placeholder', maxLength: 2000 },
      },
      {
        key: 'video',
        label: 'candidacy.step4.label',
        question: 'candidacy.step4.q',
        sub: 'candidacy.step4.sub',
        input: null,
      },
      {
        key: 'plan',
        label: 'candidacy.step5.label',
        question: 'candidacy.step5.q',
        sub: 'candidacy.step5.sub',
        input: { field: 'plan', placeholder: 'candidacy.step5.placeholder', maxLength: 4000 },
      },
      {
        key: 'skills',
        label: 'candidacy.step6.label',
        question: 'candidacy.step6.q',
        sub: 'candidacy.step6.sub',
        input: null,
      },
      {
        key: 'category',
        label: 'candidacy.step7.label',
        question: 'candidacy.step7.q',
        sub: 'candidacy.step7.sub',
        input: null,
      },
    ]);
  });

  it('counts itself — TOTAL_STEPS is the array, not a second number to keep in step', () => {
    expect(TOTAL_STEPS).toBe(WIZARD_STEPS.length);
  });

  it('stepAt clamps rather than returning undefined', () => {
    expect(stepAt(0).key).toBe('story');
    expect(stepAt(6).key).toBe('category');
    expect(stepAt(-1).key).toBe('story');
    expect(stepAt(99).key).toBe('category');
  });
});

describe('budgetPair — whole euros, minimum never above the budget (#225, FUND-09)', () => {
  it('parses a valid pair to cents', () => {
    expect(budgetPair({ budgetEuro: '8000', minViableEuro: '5000' })).toEqual({
      budgetCents: 800_000,
      minViableCents: 500_000,
    });
  });

  it('accepts a minimum equal to the budget', () => {
    expect(budgetPair({ budgetEuro: '8000', minViableEuro: '8000' })).toEqual({
      budgetCents: 800_000,
      minViableCents: 800_000,
    });
  });

  it('refuses a minimum above the budget — the DB CHECK says the same', () => {
    expect(budgetPair({ budgetEuro: '5000', minViableEuro: '5001' })).toBeNull();
  });

  it.each([
    ['an empty budget', '', '5000'],
    ['an empty minimum', '8000', ''],
    ['a decimal budget', '80.50', '5000'],
    ['a comma decimal minimum', '8000', '50,50'],
    ['a zero budget', '0', '0'],
    ['a negative budget', '-8000', '5000'],
    ['letters', 'ottomila', '5000'],
  ])('refuses %s', (_label, budgetEuro, minViableEuro) => {
    expect(budgetPair({ budgetEuro, minViableEuro })).toBeNull();
  });

  it('tolerates surrounding whitespace, since the keyboard can produce it', () => {
    expect(budgetPair({ budgetEuro: ' 8000 ', minViableEuro: ' 5000 ' })).toEqual({
      budgetCents: 800_000,
      minViableCents: 500_000,
    });
  });
});

describe('hasStandingVideo — the #221/#226 asymmetry', () => {
  it('a finished upload stands in either mode', () => {
    expect(hasStandingVideo({ uploadStatus: 'done', mode: 'fresh', hasInitial: false })).toBe(true);
    expect(hasStandingVideo({ uploadStatus: 'done', mode: 'edit', hasInitial: true })).toBe(true);
  });

  it('edit mode keeps the stored video standing until a replacement is chosen', () => {
    expect(hasStandingVideo({ uploadStatus: 'idle', mode: 'edit', hasInitial: true })).toBe(true);
    expect(hasStandingVideo({ uploadStatus: 'error', mode: 'edit', hasInitial: true })).toBe(true);
    expect(hasStandingVideo({ uploadStatus: 'canceled', mode: 'edit', hasInitial: true })).toBe(
      true,
    );
  });

  it('edit mode drops it mid-upload — the member already chose to replace it', () => {
    expect(hasStandingVideo({ uploadStatus: 'uploading', mode: 'edit', hasInitial: true })).toBe(
      false,
    );
  });

  it('a prefilled FRESH submit never inherits the prior cycle video (#221)', () => {
    // The prior candidacy's object lives under the prior candidacy's storage key; the new
    // row must own its own. This is the case a `mode`-blind rule would get wrong.
    for (const uploadStatus of ['idle', 'uploading', 'error', 'canceled', 'stalled'] as const) {
      expect(hasStandingVideo({ uploadStatus, mode: 'fresh', hasInitial: true })).toBe(false);
    }
  });

  it('edit mode with no row behaves like a fresh submit', () => {
    expect(hasStandingVideo({ uploadStatus: 'idle', mode: 'edit', hasInitial: false })).toBe(false);
  });
});

describe('per-step gating', () => {
  it('lets a complete draft leave every step', () => {
    const draft = draftWith();
    for (const [index] of WIZARD_STEPS.entries()) {
      expect(canAdvance(draft, index), `step ${index + 1}`).toBe(true);
    }
  });

  it.each([
    ['story', 0, draftWith({ story: '' }), draftWith({ story: '   ' })],
    ['goal', 1, draftWith({ goal: '' }), draftWith({ goal: '\t' })],
    ['impact', 2, draftWith({ impact: '' }), draftWith({ impact: '\n' })],
  ] as const)('holds step %s on an empty field', (_field, index, empty, blank) => {
    expect(stepBlocker(empty, index)).toBe('candidacy.error.empty');
    // Whitespace is empty: `filled` trims, so a member cannot advance on a stray return.
    expect(stepBlocker(blank, index)).toBe('candidacy.error.empty');
  });

  it('holds the video step until a video stands', () => {
    expect(stepBlocker(draftWith({ hasVideo: false }), 3)).toBe('candidacy.error.video');
    expect(stepBlocker(draftWith({ hasVideo: true }), 3)).toBeNull();
  });

  it('holds the plan step on an empty plan', () => {
    expect(stepBlocker(draftWith({ plan: '  ' }), 4)).toBe('candidacy.error.empty');
  });

  it('names the BUDGET when the plan is written and the euros are not usable', () => {
    // The regression this extraction fixed: on the way forward the member used to be told
    // «write something» after writing a plan, because the advance path only special-cased
    // the video step.
    expect(stepBlocker(draftWith({ budgetEuro: '80,50' }), 4)).toBe('candidacy.error.budget');
    expect(stepBlocker(draftWith({ minViableEuro: '' }), 4)).toBe('candidacy.error.budget');
    expect(stepBlocker(draftWith({ minViableEuro: '9000' }), 4)).toBe('candidacy.error.budget');
  });

  it('never blocks the two optional steps, whatever the draft (#226)', () => {
    // An empty declaration is first-class: skills and category can never block a submit.
    const bare = draftWith({ skills: [], category: null, linkDream: false, hasVideo: false });
    expect(canAdvance(bare, 5)).toBe(true);
    expect(canAdvance(bare, 6)).toBe(true);
  });
});

describe('submitBlockers — steps 6–7 do not gate, so submit is the last line', () => {
  it('is empty for a complete draft', () => {
    expect(submitBlockers(draftWith())).toEqual([]);
  });

  it('reports the step-5 pair the same way the step itself does', () => {
    expect(submitBlockers(draftWith({ plan: '' }))).toEqual(['candidacy.error.empty']);
    expect(submitBlockers(draftWith({ budgetEuro: '80,50' }))).toEqual(['candidacy.error.budget']);
  });

  it('reports blockers in step order', () => {
    expect(submitBlockers(draftWith({ story: '', hasVideo: false, budgetEuro: 'x' }))).toEqual([
      'candidacy.error.empty',
      'candidacy.error.video',
      'candidacy.error.budget',
    ]);
  });

  it('agrees with the advance path on every step, for every draft', () => {
    // The property that makes the rule single: whatever holds a step also blocks the submit,
    // with the SAME message. Two hand-written copies of the step-5 rule disagreed here.
    const drafts = [
      draftWith(),
      draftWith({ story: '' }),
      draftWith({ goal: '\n' }),
      draftWith({ impact: '' }),
      draftWith({ hasVideo: false }),
      draftWith({ plan: '' }),
      draftWith({ budgetEuro: '' }),
      draftWith({ budgetEuro: '1,50' }),
      draftWith({ minViableEuro: '999999' }),
    ];
    for (const draft of drafts) {
      const blockers = submitBlockers(draft);
      for (const [index] of WIZARD_STEPS.entries()) {
        const blocker = stepBlocker(draft, index);
        if (blocker !== null) expect(blockers).toContain(blocker);
      }
      expect(blockers.length === 0).toBe(
        WIZARD_STEPS.every((_step, index) => canAdvance(draft, index)),
      );
    }
  });
});

describe('prefillValues — both prefill paths mount the form filled (#226, #221)', () => {
  it('is empty without a row', () => {
    expect(prefillValues(null)).toEqual({
      story: '',
      goal: '',
      impact: '',
      plan: '',
      budgetEuro: '',
      minViableEuro: '',
      skills: [],
      category: null,
      linkDream: false,
    });
  });

  it('carries every field of a stored candidacy, cents rendered as whole euros', () => {
    expect(prefillValues(CANDIDACY)).toEqual({
      story: 'storia salvata',
      goal: 'obiettivo salvato',
      impact: 'impatto salvato',
      plan: 'piano salvato',
      budgetEuro: '8000',
      minViableEuro: '5000',
      skills: ['design', 'video'],
      category: 'artistic',
      linkDream: true,
    });
  });

  it('round-trips through the gate it will be validated by', () => {
    // A prefilled form must be submittable untouched — a prefill the parser rejects would
    // strand a member on step 5 with numbers they never typed.
    const values = prefillValues(CANDIDACY);
    expect(budgetPair(values)).toEqual({ budgetCents: 800_000, minViableCents: 500_000 });
    expect(submitBlockers({ ...values, hasVideo: true })).toEqual([]);
  });

  it('leaves the dream box unticked when the row linked no dream', () => {
    expect(prefillValues({ ...CANDIDACY, dream_id: null }).linkDream).toBe(false);
  });

  it('a prefilled row still needs its own video on a fresh resubmit', () => {
    // #221's half: the text prefills, the video does not.
    const values = prefillValues(CANDIDACY);
    const hasVideo = hasStandingVideo({
      uploadStatus: 'idle',
      mode: 'fresh',
      hasInitial: true,
    });
    expect(submitBlockers({ ...values, hasVideo })).toEqual(['candidacy.error.video']);
  });
});

describe('the screen renders THIS module (#385, source audit)', () => {
  it('reads its steps and its gates from candidacy-wizard', () => {
    const source = screen();
    expect(source).toContain("from '@/lib/candidacy-wizard'");
    for (const symbol of [
      'stepAt(',
      'stepBlocker(',
      'submitBlockers(',
      'prefillValues(',
      'hasStandingVideo(',
      'budgetPair(',
      'TOTAL_STEPS',
    ]) {
      expect(source, `missing ${symbol}`).toContain(symbol);
    }
  });

  it('keeps no index-arithmetic ladder of its own', () => {
    // The seven `{step === N ? … : null}` branches and the `step >= 5` shortcut are what the
    // extraction replaced; a new one would silently re-fork the rules.
    const source = screen();
    for (const ladder of ['step === 0', 'step === 1', 'step === 2', 'step === 3', 'step >= 5']) {
      expect(source, `re-grown ladder: ${ladder}`).not.toContain(ladder);
    }
  });

  it('parses no euros of its own', () => {
    // budgetPair is the only parser; a second one drifts from the «numeri interi» contract.
    const source = screen();
    expect(source).not.toContain('parseEuroIntegerToCents');
    expect(source).not.toContain('parseEuroToCents');
  });

  it('keeps both prefill paths wired (#226 edit, #221 cross-cycle resubmit)', () => {
    const source = screen();
    expect(source).toContain('getMyCandidacy');
    expect(source).toContain('getMyLatestPriorCandidacy');
    expect(source).toContain("edit === '1'");
    expect(source).toContain("resubmit === '1'");
    // Explicit resubmission stays explicit: submit is updateCandidacy only in edit mode.
    expect(source).toContain("mode === 'edit' && initial");
    expect(source).toContain('updateCandidacy(');
    expect(source).toContain('submitCandidacy(');
  });
});
