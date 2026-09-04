import { z } from 'zod';
import { nonBlankString, trimmedNonBlank } from './primitives.ts';

/**
 * Read-model of one public progress update (#230, FUND-26) — a note the winner posts
 * while realizing the dream, bound to the cycle and optionally to the plan phase it is
 * about.
 *
 * It is EVIDENCE, not a declaration. Nothing here gates closure: `close_cycle()` takes its
 * outcome as an operator-supplied parameter and the tranche gate is #231's
 * `realization_plan_phases.verified_at`. A note that could declare its own realization
 * would invert «realisation is derived, never declared».
 *
 * There is no reaction count, no view count and no field that could become one (rule #3).
 * The bound below mirrors the table's CHECK exactly — a row that fails it is an upstream
 * bug to surface, not a state to absorb.
 */
export const realizationUpdateSchema = z.object({
  id: z.string().uuid(),
  edition_id: z.string().uuid(), // the cycle — the binding the issue asks for
  profile_id: z.string().uuid(), // the winner; trigger-pinned to the cycle's winner
  // Optional refinement: most notes are about the project, not one tranche. Null also
  // means «the phase this pointed at is gone» (ON DELETE SET NULL on erasure).
  plan_phase_id: z.string().uuid().nullable(),
  body: nonBlankString(2000, 'the update needs something to say'),
  // Withdrawn by its author. Every public read excludes it; the row is never hard-deleted.
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RealizationUpdateRow = z.infer<typeof realizationUpdateSchema>;

/**
 * What the winner posts. `id`, `deleted_at` and the timestamps are absent for the usual
 * reason — none of them is the author's to choose.
 *
 * `profile_id` IS present and is sent by the client, because the insert policy's WITH
 * CHECK pins it to `auth.uid()`: a mismatched value is refused by the database rather than
 * trusted. Write-side trimming (`trimmedNonBlank`) rather than the read-side rule: client
 * input is normalized before it reaches a column whose CHECK forbids a blank body.
 */
export const realizationUpdateInsertSchema = realizationUpdateSchema
  .pick({
    edition_id: true,
    profile_id: true,
  })
  .extend({
    body: trimmedNonBlank(2000, 'the update needs something to say'),
    // Defaulted rather than required: a note about the project as a whole is the ordinary
    // case, not an omission to nag about.
    plan_phase_id: z.string().uuid().nullable().default(null),
  });
export type RealizationUpdateInsert = z.infer<typeof realizationUpdateInsertSchema>;

/**
 * An edit. `edition_id` and `profile_id` are deliberately absent — a note never re-targets
 * a cycle or changes hands, and neither is a granted column.
 *
 * `deleted_at` is absent too: withdrawal is `deleteRealizationUpdate`, which sets the
 * timestamp server-side. A client-chosen withdrawal time would be a fact about the past
 * the author gets to pick.
 */
export const realizationUpdateEditSchema = z
  .object({
    body: trimmedNonBlank(2000, 'the update needs something to say'),
    plan_phase_id: z.string().uuid().nullable(),
  })
  .partial();
export type RealizationUpdateEdit = z.infer<typeof realizationUpdateEditSchema>;
