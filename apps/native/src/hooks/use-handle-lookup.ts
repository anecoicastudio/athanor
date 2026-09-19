import { useEffect, useState } from 'react';
import { isHandleTaken } from '@athanor/api';
import type { HandleLookup } from '@/lib/handle-status';
import { supabase } from '@/lib/supabase';

/** Long enough that a word typed at speed is looked up once, short enough to feel live. */
const DEBOUNCE_MS = 400;

/**
 * Whether `candidate` is already someone's handle, asked of the database as the person types
 * (#782). `enabled` is the caller's «this is worth asking» — a claimable shape that is not the
 * member's own handle; nothing else is sent.
 *
 * The answer is keyed on the candidate it was asked for, so a slow reply for `lun` can never
 * colour `luna`: until the answer for exactly this candidate arrives, it reads `checking`.
 * A failed lookup is `failed`, never «free» — the unique index is the gate, and a courtesy
 * check that guessed would be a lie on screen.
 */
export function useHandleLookup(candidate: string, enabled: boolean): HandleLookup {
  const [answer, setAnswer] = useState<{ candidate: string; lookup: HandleLookup }>({
    candidate: '',
    lookup: 'idle',
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      isHandleTaken(supabase, candidate)
        .then((taken) => {
          if (!cancelled) setAnswer({ candidate, lookup: taken ? 'taken' : 'free' });
        })
        .catch(() => {
          if (!cancelled) setAnswer({ candidate, lookup: 'failed' });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candidate, enabled]);

  if (!enabled) return 'idle';
  return answer.candidate === candidate ? answer.lookup : 'checking';
}
