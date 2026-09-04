import { hasAnsweredMomento, momentiKeys } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * «Has this member ever accepted or passed a Momento» — the persisted half of the Momenti empty
 * state's copy choice (#600). The other half, the in-session swipe-through latch, is component
 * state and dies on a remount, so without this a cold start showed «Quando troviamo la persona
 * giusta» to a member who had swiped through the day before.
 *
 * Carries no `enabled` gate, like the deck beside it. The answer is needed exactly when the deck
 * settles empty; fetching in parallel from mount means it has almost always settled by then, so
 * the empty state does not swap its sentence a beat after rendering. The read itself is one
 * indexed row at most (`limit 1`) and never a count.
 *
 * Both swipe mutations invalidate `momentiKeys.answered()` alongside the deck: the first
 * swipe-through of a session would otherwise be answered from a `false` cached before it.
 *
 * It carries no `meta.persist: false`, so the shared persister rehydrates it — the same
 * mechanism that restored the empty deck as a settled success and made #600 visible now
 * restores the fact beside it, and on the device where the swipe happened the first frame
 * after a cold start already holds both. Not on a SECOND device, though: one that persisted
 * `false` before the member answered elsewhere rehydrates that `false` as settled data, so it
 * can show the never-had-one copy for one frame — the symptom one layer out. It self-corrects
 * on the mount refetch (rehydrated data is older than `staleTime`), and the copy it degrades to
 * is a promise rather than a falsehood, so this is a known soft edge and not a second latch.
 */
export function momentiAnsweredQuery() {
  return queryOptions({
    queryKey: momentiKeys.answered(),
    queryFn: () => hasAnsweredMomento(supabase),
  });
}

export function useMomentiAnswered() {
  return useQuery(momentiAnsweredQuery());
}
