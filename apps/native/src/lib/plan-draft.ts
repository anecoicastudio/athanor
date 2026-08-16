import type { RealizationPlanPhaseRow } from '@athanor/api';

/**
 * One phase as the authoring screen holds it (#229): the money stays a typed euro string
 * until it is saved, and `id` is null for a phase that does not exist server-side yet.
 *
 * `key` is a stable React key that survives a re-index; `id` is the row's identity. They
 * are separate because a new phase has a key before it has an id, and because a phase must
 * keep its id across edits — `fund_payout_ledger.plan_phase_id` is ON DELETE SET NULL, so a
 * phase that is deleted and re-created loses whatever release pointed at it.
 */
export type DraftPhase = {
  key: string;
  id: string | null;
  title: string;
  scheduledFor: string; // 'YYYY-MM-DD', the DATE column's shape
  amountCents: number | null; // null while the euro field is empty or unparsed
  criteria: string;
};

/** The four facts a tranche release reads, as a phase write carries them. */
export type PhaseShape = {
  sort: number;
  title: string;
  scheduled_for: string;
  amount_cents: number;
  verification_criteria: string;
};

/** The writes a save must perform, already grouped. See `applyOrder` for why the order matters. */
export type PhaseDiff = {
  deletes: string[];
  updates: { id: string; patch: PhaseShape }[];
  inserts: PhaseShape[];
};

/** Server rows → editable draft, in plan order. */
export function draftFromPhases(rows: RealizationPlanPhaseRow[]): DraftPhase[] {
  return [...rows]
    .sort((a, b) => a.sort - b.sort)
    .map((row) => ({
      key: row.id,
      id: row.id,
      title: row.title,
      scheduledFor: row.scheduled_for,
      amountCents: row.amount_cents,
      criteria: row.verification_criteria,
    }));
}

/** What the draft's phases promise, in cents. Unparsed amounts count as nothing. */
export function costedCents(phases: DraftPhase[]): number {
  return phases.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
}

/** A phase is savable only when it carries all four facts a tranche release reads. */
export function phaseComplete(phase: DraftPhase): boolean {
  return (
    phase.title.trim().length > 0 &&
    phase.scheduledFor.length > 0 &&
    phase.amountCents !== null &&
    phase.amountCents > 0 &&
    phase.criteria.trim().length > 0
  );
}

/**
 * The writes that turn `server` into `draft`.
 *
 * Position is `sort`, derived from the draft's order, so removing a phase renumbers the
 * ones after it. An existing phase is always an UPDATE — never a delete followed by an
 * insert — because the row's identity is what a funded release points at.
 *
 * Incomplete phases are skipped rather than written: the screen refuses the save and says
 * which fact is missing, so a half-typed phase never reaches the database as a tranche.
 */
export function phaseDiff(server: RealizationPlanPhaseRow[], draft: DraftPhase[]): PhaseDiff {
  const kept = new Set(draft.map((p) => p.id).filter((id): id is string => id !== null));
  const diff: PhaseDiff = { deletes: [], updates: [], inserts: [] };

  for (const row of server) {
    if (!kept.has(row.id)) diff.deletes.push(row.id);
  }

  const byId = new Map(server.map((row) => [row.id, row]));
  draft.forEach((phase, index) => {
    if (!phaseComplete(phase)) return;
    const shape = {
      sort: index + 1,
      title: phase.title.trim(),
      scheduled_for: phase.scheduledFor,
      amount_cents: phase.amountCents as number,
      verification_criteria: phase.criteria.trim(),
    };
    if (phase.id === null) {
      diff.inserts.push(shape);
      return;
    }
    const row = byId.get(phase.id);
    const unchanged =
      row !== undefined &&
      row.sort === shape.sort &&
      row.title === shape.title &&
      row.scheduled_for === shape.scheduled_for &&
      row.amount_cents === shape.amount_cents &&
      row.verification_criteria === shape.verification_criteria;
    if (!unchanged) diff.updates.push({ id: phase.id, patch: shape });
  });

  // Updates ascend by target position so a renumber can never collide with a position that
  // is still occupied: deletes free the low slots first, then each move lands in one the
  // previous move vacated. unique (plan_id, sort) is what would otherwise refuse.
  diff.updates.sort((a, b) => a.patch.sort - b.patch.sort);
  return diff;
}

/**
 * The order a save must apply the diff in, and the reason: deletes and downward re-costs
 * free ceiling headroom that a new phase may need. Inserting first would meet
 * «phases exceed declared payable» on a plan that in fact fits.
 */
export const applyOrder = ['deletes', 'updates', 'inserts'] as const;
