import { getMomentiDeck, momentiKeys } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * The waiting-Momenti deck. Three surfaces read it and none of them may disagree: the Momenti
 * tab renders the cards, the tab bar lights its ✦ spark from the same array (a spark, never a
 * count — rule #3 / DESIGN §8), and Home's `MomentiCard` shows the top one. Accepting or
 * declining invalidates `momentiKeys.deck()` once and all three settle together.
 */
export function momentiDeckQuery() {
  return queryOptions({
    queryKey: momentiKeys.deck(),
    queryFn: () => getMomentiDeck(supabase),
  });
}

export function useMomentiDeck() {
  return useQuery(momentiDeckQuery());
}
