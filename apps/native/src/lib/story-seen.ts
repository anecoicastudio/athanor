import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '@/lib/log';

/**
 * Locally persisted "story finished" author ids (#298). Deliberately NOT a server table:
 * stored view rows would let an author infer who watched (rule #3 territory), and a device
 * preference is not worth a migration + RLS + pgTAP. Precedent: onboarding-draft.ts.
 *
 * The public API is `string[]`, not `Set`: the ids also live in the TanStack query cache,
 * which the app persists through JSON.stringify — and `JSON.stringify(new Set(...))` is
 * `'{}'`, so a Set silently loses every id on the persist round-trip. Consumers derive a
 * Set at the edge (use-story-seen.ts).
 */
const KEY = 'athanor.stories.seen';
const VERSION = 1 as const;
/** Stories expire in 24h, so old ids are dead weight — cap the list, newest kept. */
const MAX_IDS = 200;

type Stored = { v: typeof VERSION; ids: string[] };

/**
 * Guard for untrusted cache data. Heals caches poisoned by the pre-fix bug where a Set was
 * persisted through the query persister (JSON.stringify(Set) === '{}'). Anything that is not
 * an array of strings degrades to [] — rings re-light, nothing breaks.
 */
export function sanitizeSeenIds(data: unknown): string[] {
  return Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : [];
}

export async function loadSeenStoryIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed?.v !== VERSION) return [];
    return [...new Set(sanitizeSeenIds(parsed.ids))];
  } catch (e) {
    devWarn('[story-seen] load', e);
    return []; // corrupt/unreadable → nothing seen; rings re-light, nothing breaks
  }
}

export async function persistSeenStoryIds(ids: readonly string[]): Promise<void> {
  try {
    const list = [...new Set(ids)].slice(-MAX_IDS);
    await AsyncStorage.setItem(KEY, JSON.stringify({ v: VERSION, ids: list } satisfies Stored));
  } catch (e) {
    devWarn('[story-seen] persist', e); // best-effort: worst case a ring re-lights after restart
  }
}
