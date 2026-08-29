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
 * restores the fact beside it, and the first frame after a cold start already holds both.
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
