import { parseEuroIntegerToCents } from '@athanor/core';
import type { MessageKey } from '@athanor/i18n';
import type { DreamCandidacy, ProjectCategory } from '@athanor/schemas';
import type { UploadStatus } from '@/lib/media/use-candidacy-upload';

/**
 * The seven candidacy steps as data (07 §3.4; #226 added steps 6–7; #385 extracted this).
 *
 * The screen used to spell each step three times — an index-arithmetic `canAdvance`, a
 * `{step === N ? … : null}` ladder, and a hand-written re-check of the step-5 rule at
 * submit — and none of it was assertable: `apps/native/vitest.config.ts` runs
 * `environment: 'node'` over a `.test.ts` glob, so a `.tsx` screen is structurally
 * uncollectable. Same reason `fund-disclosure.ts` and `fund-cycle.ts` live here.
 *
 * Each step owns its own validator and returns the i18n key of what blocks it, so the
 * message a member sees is chosen in ONE place. `advance()` and `onSubmit()` both run these
 * validators; before the extraction they were two rules 30 lines apart that disagreed —
 * a bad budget on step 5 said «Scrivi qualcosa prima di continuare» on the way forward and
 * «Indica budget e minimo…» at submit, and the submit branch was unreachable.
 */

/** Stable per-step identity. The screen switches its bespoke bodies on this, never on an index. */
export type WizardStepKey = 'story' | 'goal' | 'impact' | 'video' | 'plan' | 'skills' | 'category';

/** The long-form text fields; the two euro fields are typed too and parsed by `budgetPair`. */
export type WizardTextField = 'story' | 'goal' | 'impact' | 'plan' | 'budgetEuro' | 'minViableEuro';

/** Everything the member types or taps. This is the state the screen holds and prefills. */
export type WizardValues = {
  readonly story: string;
  readonly goal: string;
  readonly impact: string;
  readonly plan: string;
  /** Whole euros as typed — cents are `budgetPair`'s job, so the field can hold '' or junk. */
  readonly budgetEuro: string;
  readonly minViableEuro: string;
  readonly skills: string[];
  readonly category: ProjectCategory | null;
  readonly linkDream: boolean;
};

/**
 * What the gating rules read. `hasVideo` is not typed state — it comes from the upload hook
 * and the prefill mode via `hasStandingVideo`, which is why it rides beside the values
 * rather than inside them.
 */
export type WizardDraft = WizardValues & { readonly hasVideo: boolean };

/** 'edit' = same-cycle update (#226); 'fresh' = a new row, prefilled or not (#221). */
export type WizardMode = 'edit' | 'fresh';

/** The single multiline field a step collects, when it collects one. */
export type WizardInput = {
  readonly field: WizardTextField;
  readonly placeholder: MessageKey;
  /** Mirrors the column's `z.string().max(…)` in `dreamCandidacySchema`. */
  readonly maxLength: number;
};

export type WizardStep = {
  readonly key: WizardStepKey;
  readonly label: MessageKey;
  readonly question: MessageKey;
  readonly sub: MessageKey;
  readonly input: WizardInput | null;
  /** The i18n key of what blocks leaving this step, or null when it may be left. */
  readonly validate: (draft: WizardDraft) => MessageKey | null;
};

export type BudgetPair = {
  readonly budgetCents: number;
  readonly minViableCents: number;
};

const filled = (value: string) => value.trim().length > 0;

/**
 * The step-5 euro pair, or null unless both are whole positive euros and the minimum does
 * not exceed the budget — the same three conditions `candidacy.error.budget` names.
 *
 * The screen submits exactly what this returns, so the numbers that pass the gate and the
 * numbers that reach `submitCandidacy` cannot be computed differently. Integer-only by copy
 * contract, not by taste: `parseEuroIntegerToCents` exists (#387) because the catalogs
 * promise «numeri interi» in `candidacy.budget.hint`.
 */
export function budgetPair(
  values: Pick<WizardValues, 'budgetEuro' | 'minViableEuro'>,
): BudgetPair | null {
  const budgetCents = parseEuroIntegerToCents(values.budgetEuro);
  const minViableCents = parseEuroIntegerToCents(values.minViableEuro);
  if (budgetCents === null || minViableCents === null) return null;
  // Mirrors the DB CHECK and candidacyInsertSchema's refine: a minimum above the budget is
  // not a minimum.
  if (minViableCents > budgetCents) return null;
  return { budgetCents, minViableCents };
}

/**
 * Whether a video stands for this submit.
 *
 * Edit mode (#226) replaces a video in place, so the stored one stands until a replacement
 * lands — but never mid-upload, when the member has already chosen to replace it. A
 * prefilled fresh submit (#221) is a NEW row: the prior cycle's object stays under the prior
 * candidacy's storage key, so a new video is always required. That asymmetry is the whole
 * reason step 4 cannot be validated from typed state alone.
 */
export function hasStandingVideo(input: {
  readonly uploadStatus: UploadStatus;
  readonly mode: WizardMode;
  readonly hasInitial: boolean;
}): boolean {
  if (input.uploadStatus === 'done') return true;
  return input.mode === 'edit' && input.hasInitial && input.uploadStatus !== 'uploading';
}

/**
 * The wizard's steps, in order. Adding a step is one entry here plus its catalog keys —
 * the screen reads the label/question/sub/placeholder from this array, so a step cannot
 * gain a screen without gaining a validator.
 */
export const WIZARD_STEPS = [
  {
    key: 'story',
    label: 'candidacy.step1.label',
    question: 'candidacy.step1.q',
    sub: 'candidacy.step1.sub',
    input: { field: 'story', placeholder: 'candidacy.step1.placeholder', maxLength: 4000 },
    validate: (draft: WizardDraft) => (filled(draft.story) ? null : 'candidacy.error.empty'),
  },
  {
    key: 'goal',
    label: 'candidacy.step2.label',
    question: 'candidacy.step2.q',
    sub: 'candidacy.step2.sub',
    input: { field: 'goal', placeholder: 'candidacy.step2.placeholder', maxLength: 2000 },
    validate: (draft: WizardDraft) => (filled(draft.goal) ? null : 'candidacy.error.empty'),
  },
  {
    key: 'impact',
    label: 'candidacy.step3.label',
    question: 'candidacy.step3.q',
    sub: 'candidacy.step3.sub',
    input: { field: 'impact', placeholder: 'candidacy.step3.placeholder', maxLength: 2000 },
    validate: (draft: WizardDraft) => (filled(draft.impact) ? null : 'candidacy.error.empty'),
  },
  {
    key: 'video',
    label: 'candidacy.step4.label',
    question: 'candidacy.step4.q',
    sub: 'candidacy.step4.sub',
    input: null,
    validate: (draft: WizardDraft) => (draft.hasVideo ? null : 'candidacy.error.video'),
  },
  {
    key: 'plan',
    label: 'candidacy.step5.label',
    question: 'candidacy.step5.q',
    sub: 'candidacy.step5.sub',
    input: { field: 'plan', placeholder: 'candidacy.step5.placeholder', maxLength: 4000 },
    // The one place the step-5 rule is written. An empty plan is «write something»; a plan
    // with an unusable euro pair is the budget line, which names the three conditions the
    // member has to satisfy. Saying «write something» to a member who wrote a plan and typed
    // €1,50 was the bug this extraction closed.
    validate: (draft: WizardDraft) => {
      if (!filled(draft.plan)) return 'candidacy.error.empty';
      return budgetPair(draft) === null ? 'candidacy.error.budget' : null;
    },
  },
  {
    // Skills the dream needs (#226, FUND-10) — optional, so an empty declaration is
    // first-class and can never block a submit.
    key: 'skills',
    label: 'candidacy.step6.label',
    question: 'candidacy.step6.q',
    sub: 'candidacy.step6.sub',
    input: null,
    validate: () => null,
  },
  {
    // Category (#226, D43) + the optional dream link (D12/FUND-50). Optional for the same
    // reason as step 6.
    key: 'category',
    label: 'candidacy.step7.label',
    question: 'candidacy.step7.q',
    sub: 'candidacy.step7.sub',
    input: null,
    validate: () => null,
  },
] as const satisfies readonly WizardStep[];

export const TOTAL_STEPS = WIZARD_STEPS.length;

/**
 * The step at `index`, clamped into range.
 *
 * Total on purpose: `noUncheckedIndexedAccess` is on, and a screen that has to unwrap
 * `WIZARD_STEPS[step]` before it can render either grows a non-null assertion or grows a
 * branch nothing can reach. `step` is only ever moved one at a time between 0 and the last.
 */
export function stepAt(index: number): WizardStep {
  const clamped = Math.min(Math.max(Math.trunc(index), 0), WIZARD_STEPS.length - 1);
  return WIZARD_STEPS[clamped] ?? WIZARD_STEPS[0];
}

/** The i18n key of what blocks leaving `step`, or null when the member may go on. */
export function stepBlocker(draft: WizardDraft, step: number): MessageKey | null {
  return stepAt(step).validate(draft);
}

/** Whether the member may leave `step`. */
export function canAdvance(draft: WizardDraft, step: number): boolean {
  return stepBlocker(draft, step) === null;
}

/**
 * Everything blocking a submit, in step order; empty means the payload may be built.
 *
 * Every step is re-checked, not only step 5: steps 6–7 never gate, so the submit button is
 * the last line, and a rule that only lives on the way forward is a rule that a deep link or
 * a future step reordering can walk around. In practice `advance()` gates steps 1–5, so the
 * reachable outcome is unchanged — the earlier entries are the belt, not a new behaviour.
 */
export function submitBlockers(draft: WizardDraft): readonly MessageKey[] {
  const blockers: MessageKey[] = [];
  for (const step of WIZARD_STEPS) {
    const blocker = step.validate(draft);
    if (blocker !== null) blockers.push(blocker);
  }
  return blockers;
}

/**
 * The form as it mounts: empty on a fresh submit, prefilled from `initial` on both prefill
 * paths (`?edit=1` #226, `?resubmit=1` #221).
 *
 * Cents come back as whole euros because that is what the member typed and what
 * `budgetPair` will parse again — the round-trip is lossless for every value the field can
 * produce, since the field cannot produce a fractional euro in the first place.
 */
export function prefillValues(initial: DreamCandidacy | null): WizardValues {
  return {
    story: initial?.story ?? '',
    goal: initial?.goal ?? '',
    impact: initial?.impact ?? '',
    plan: initial?.plan ?? '',
    budgetEuro: initial ? String(Math.round(initial.budget_cents / 100)) : '',
    minViableEuro: initial ? String(Math.round(initial.min_viable_cents / 100)) : '',
    skills: initial?.skills_needed ?? [],
    category: initial?.category ?? null,
    // A prior-cycle dream_id may point at a retired dream; the box only records that the
    // member had linked one — which dream a fresh submit links is the screen's call (D12).
    linkDream: Boolean(initial?.dream_id),
  };
}
