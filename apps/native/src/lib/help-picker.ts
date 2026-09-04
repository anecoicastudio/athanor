import type { Help, HelpStatus, Milestone, MilestoneStatus } from '@athanor/schemas';

/**
 * How a tappa reads to the viewer: one of my offer's DB statuses, or 'available' when I have
 * no row on it yet. Derived from `HelpStatus` rather than spelled out, so a status added to
 * the DB enum surfaces as a type error at every render site instead of quietly rendering
 * nothing (the three hand-written copies of this union drifted apart exactly that way).
 */
export type HelpState = HelpStatus | 'available';

/**
 * Half of the rule below, on its own because two surfaces need it and only one of them has a
 * list to filter. The picker calls {@link helpableMilestones}; `MilestoneRow` renders one tappa
 * at a time and knows only its status, so before this it could not consult the rule at all —
 * and did not, which is why «Aiuta» rendered beside the ✓ of a finished tappa on Person Detail
 * while the picker correctly refused to list it (#660, *Beyond the issue*). One predicate, one
 * home: a status that stops being helpable changes here and both surfaces follow.
 */
export function isHelpableStatus(status: MilestoneStatus): boolean {
  return status !== 'done';
}

/**
 * The tappe a viewer can still offer help on (PRD §132: «Fai accadere questo sogno» →
 * pick a tappa → offer). Extracted out of the sheet because `apps/native` has no
 * component-render harness — the selection rule is the part worth testing, and buried in
 * JSX it would be untestable.
 *
 * A tappa survives when its status is still helpable and the viewer has no `milestone_helps`
 * row on it — `declined` included. `20260614131843_milestone_helps.sql` is
 * `unique (milestone_id, helper_id)` with NO `deleted_at` partial, so a declined offer can
 * never be re-offered: leaving it in the picker would guarantee a 23505 the moment it was
 * chosen.
 *
 * `myHelps` is already helper-scoped by `listMyHelpsForMilestones`, so no helper_id filter here.
 */
export function helpableMilestones(milestones: Milestone[], myHelps: Help[]): Milestone[] {
  const offeredOn = new Set(myHelps.map((h) => h.milestone_id));
  return milestones.filter((m) => isHelpableStatus(m.status) && !offeredOn.has(m.id));
}
