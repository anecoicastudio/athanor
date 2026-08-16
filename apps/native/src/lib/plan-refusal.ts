import { planRefusalOf, type PlanRefusal } from '@athanor/api';
import type { MessageKey } from '@athanor/i18n';

/**
 * Server refusal → copy (#229). The database's raised text is the stable contract (#103
 * idiom); this is the only place it becomes a sentence, so a ceiling refusal never reaches
 * the winner as «could not save».
 *
 * Exhaustive by type: adding a refusal to `PLAN_REFUSALS` without a key here fails to
 * compile, which is the point — an unmapped refusal would silently become the generic one.
 */
const REFUSAL_KEY: Record<PlanRefusal, MessageKey> = {
  'phases exceed declared payable': 'fund.plan.error.ceiling',
  'plan has no phases': 'fund.plan.error.noPhases',
  'publication out of phase': 'fund.plan.error.outOfPhase',
  'plan already published': 'fund.plan.error.alreadyPublished',
  'not the plan author': 'fund.plan.error.notAuthor',
  'viability not confirmed': 'fund.plan.error.notConfirmed',
  // Reachable only through a race or a stale screen: the plan, the cycle or the winner
  // moved under the draft. They are the same news to the member — this is no longer yours
  // to write — and the honest generic line is better than four ways to say it.
  'plan not found': 'fund.plan.error.generic',
  'edition not found': 'fund.plan.error.generic',
  'no winner declared': 'fund.plan.error.generic',
  'plan does not bind the cycle winner': 'fund.plan.error.generic',
  'auth required': 'fund.plan.error.generic',
};

/** The copy key for a failed plan write. Anything unnamed degrades to the generic line. */
export function planRefusalKey(error: unknown): MessageKey {
  const refusal = planRefusalOf(error);
  return refusal ? REFUSAL_KEY[refusal] : 'fund.plan.error.generic';
}
