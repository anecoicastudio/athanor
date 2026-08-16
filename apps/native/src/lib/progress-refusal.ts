import { type UpdateRefusal, updateRefusalOf } from '@athanor/api';
import type { MessageKey } from '@athanor/i18n';

/**
 * Server refusal → copy (#230), the `plan-refusal` idiom. The database's raised text is the
 * stable contract; this is the only place it becomes a sentence.
 *
 * Exhaustive by type: adding a refusal to `UPDATE_REFUSALS` without a key here fails to
 * compile, which is the point — an unmapped refusal would silently become the generic one.
 *
 * An RLS denial is NOT in `UPDATE_REFUSALS` (it raises no message), so it lands on the
 * generic line through `updateRefusalOf` returning null. That is honest: the two ways to be
 * refused by a policy here — «you are not the winner» and «this cycle is not realizing» —
 * are both invisible to a member who reached this screen legitimately, and the screen never
 * shows the compose surface to anyone else.
 */
const REFUSAL_KEY: Record<UpdateRefusal, MessageKey> = {
  'not the cycle winner': 'fund.progress.error.notWinner',
  'plan phase belongs to another cycle': 'fund.progress.error.phaseOther',
  'plan phase not found': 'fund.progress.error.phaseGone',
  // Reachable only through a race or a stale screen: the cycle moved under the compose
  // box. Same news to the member either way — this is no longer yours to write.
  'edition not found': 'fund.progress.error.generic',
  'no winner declared': 'fund.progress.error.generic',
};

/** The copy key for a failed progress write. Anything unnamed degrades to the generic line. */
export function progressRefusalKey(error: unknown): MessageKey {
  const refusal = updateRefusalOf(error);
  return refusal ? REFUSAL_KEY[refusal] : 'fund.progress.error.generic';
}
