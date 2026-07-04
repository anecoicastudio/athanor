import { getAuraEventsSince } from '@athanor/api';
import { summarizeWeek } from '@athanor/core';
import type { WeekRecap } from '@athanor/core';
import { supabase } from '@/lib/supabase';

/**
 * The ONE queryFn behind `auraKeys.recap(profileId)` — Home's WeekCard and the
 * Circle AnalyticsLiteCard share the key, so they must share the fetch shape
 * (two divergent queryFns under one key is a cache hazard). Last 8 days of
 * ledger events, summarized client-side (`now` injected at the call boundary —
 * core stays clock-free, rule in .claude/rules/core.md).
 */
export async function fetchWeekRecap(profileId: string): Promise<WeekRecap> {
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getAuraEventsSince(supabase, profileId, since);
  return summarizeWeek(rows, new Date());
}
