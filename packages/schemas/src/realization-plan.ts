import { z } from 'zod';
import { nonBlankString } from './primitives';

/**
 * Read-model of one cycle's realization plan (#228, FUND-25) — the winner's published
 * commitment, and the thing tranches release against (FUND-53).
 *
 * Structured where money touches it, prose elsewhere: everything here is prose, because
 * everything a RELEASE reads lives on the phases (date, amount, verification criteria).
 *
 * «Budget disponibile» is deliberately absent. It is `fund_editions.confirmed_pool_cents`
 * — the #220 announcement snapshot — and copying it onto the plan would make two rows
 * answer one question. The database enforces the relationship instead: the phase sum
 * cannot exceed the cycle's declared payable.
 *
 * The bounds below mirror the table's CHECK constraints exactly, character for character.
 * A row that fails them is an upstream bug to surface, not a state to absorb.
 */
export const realizationPlanSchema = z.object({
  id: z.string().uuid(),
  edition_id: z.string().uuid(), // unique in-table: one plan per cycle
  candidacy_id: z.string().uuid(), // trigger-bound to the cycle's confirmed winner
  objective: nonBlankString(4000, 'objective is required'),
  expected_result: nonBlankString(4000, 'expected result is required'),
  // Recorded, possibly empty — a dream can genuinely have no suppliers. '' is the
  // recorded-as-none value; there is no null variant to disambiguate.
  professionals: z.string().max(4000),
  suppliers: z.string().max(4000),
  // null = draft (#229 publishes). Only a published plan is world-readable.
  published_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RealizationPlanRow = z.infer<typeof realizationPlanSchema>;

/**
 * Read-model of one plan phase (#228) — a tranche's three facts: when, how much, and what
 * its verification is judged against.
 *
 * `amount_cents` is strictly positive because a phase IS a tranche; a zero-euro milestone
 * is progress (#230), not a release unit. The per-plan CEILING (phase sum ≤ the cycle's
 * declared payable) is cross-row and lives only in the database trigger — a single-row
 * schema cannot see its siblings, and pretending otherwise would be a check that passes
 * for the wrong reason.
 *
 * `verified_at` is #231's slot: nothing writes it yet, and the release gate that will read
 * it is that issue's. Present here so the shape is not re-declared when it lands.
 */
export const realizationPlanPhaseSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  sort: z.number().int().positive(), // unique per plan; display + "which tranche is next"
  title: nonBlankString(200, 'phase title is required'),
  scheduled_for: z.string(), // date column — 'YYYY-MM-DD', «tempi»
  amount_cents: z.number().int().positive(), // «costi previsti»
  verification_criteria: nonBlankString(2000, 'verification criteria are required'),
  verified_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RealizationPlanPhaseRow = z.infer<typeof realizationPlanPhaseSchema>;
