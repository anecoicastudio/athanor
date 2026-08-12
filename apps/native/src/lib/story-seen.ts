import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '@/lib/log';

/**
 * Locally persisted "story finished" author ids (#298). Deliberately NOT a server table:
 * stored view rows would let an author infer who watched (rule #3 territory), and a device
 * preference is not worth a migration + RLS + pgTAP. Precedent: onboarding-draft.ts.
 */
const KEY = 'athanor.stories.seen';
const VERSION = 1 as const;
/** Stories expire in 24h, so old ids are dead weight — cap the list, newest kept. */
const MAX_IDS = 200;

type Stored = { v: typeof VERSION; ids: string[] };

export async function loadSeenStoryIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed?.v !== VERSION || !Array.isArray(parsed.ids)) return new Set();
    return new Set(parsed.ids.filter((id): id is string => typeof id === 'string'));
  } catch (e) {
    devWarn('[story-seen] load', e);
    return new Set(); // corrupt/unreadable → nothing seen; rings re-light, nothing breaks
  }
}

export async function persistSeenStoryIds(ids: ReadonlySet<string>): Promise<void> {
  try {
    const list = [...ids].slice(-MAX_IDS);
    await AsyncStorage.setItem(KEY, JSON.stringify({ v: VERSION, ids: list } satisfies Stored));
  } catch (e) {
    devWarn('[story-seen] persist', e); // best-effort: worst case a ring re-lights after restart
  }
}
