import {
  ZERO_AURA_SNAPSHOT,
  auraEventSchema,
  starKeySchema,
  type AuraEvent,
  type AuraScore,
  type AuraSnapshot,
  type Star,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

/** Read-only Aura query-key factories (api rule: per-entity). No mutation keys — rule #1. */
export const auraKeys = {
  all: ['aura'] as const,
  detail: (profileId: string) => [...auraKeys.all, 'detail', profileId] as const,
  score: (profileId: string) => [...auraKeys.all, 'score', profileId] as const,
  recap: (profileId: string) => [...auraKeys.all, 'recap', profileId] as const,
};

export const ledgerKeys = {
  all: ['ledger'] as const,
  list: (profileId: string, filter: 'all' | 'gained' | 'decayed') =>
    [...ledgerKeys.all, profileId, { filter }] as const,
};

export const starKeys = {
  all: ['stars'] as const,
  list: (profileId: string) => [...starKeys.all, profileId] as const,
  progress: (profileId: string) => [...starKeys.all, 'progress', profileId] as const,
};

/** Zero AuraScore (M6 §2.2a — coalesce when no engine row exists yet). */
function zeroAuraScore(profileId: string): AuraScore {
  return {
    profileId,
    score: 0,
    breakdown: {
      contributi: 0,
      eventi: 0,
      collaborazioni: 0,
      valore: 0,
      recensioni: 0,
      affidabilita: 0,
    },
    peakScore: 0,
    lastQualifyingActionAt: null,
    computedAt: new Date(0).toISOString(),
  };
}

/**
 * The compact snapshot the M1+ identity surfaces read (score + six lit/unlit flags).
 * Reads real `aura_scores` + own `stars`; a missing score row coalesces to the
 * canonical zero-snapshot (backend 07 §2.2a — NEVER null). Unchanged return type, so
 * the 4 existing mobile consumers keep working. Aura is never client-writable (rule #1).
 */
export async function getAuraScore(
  client: AthanorClient,
  profileId: string,
): Promise<AuraSnapshot> {
  const { data: scoreRow } = await client
    .from('aura_scores')
    .select('score')
    .eq('profile_id', profileId)
    .maybeSingle();

  const { data: starRows } = await client
    .from('stars')
    .select('star_id, granted_at')
    .eq('profile_id', profileId);

  if (!scoreRow && (!starRows || starRows.length === 0)) return ZERO_AURA_SNAPSHOT;

  const lit = new Set(
    (starRows ?? [])
      .filter((s) => s.granted_at != null && starKeySchema.safeParse(s.star_id).success)
      .map((s) => s.star_id),
  );

  return {
    score: scoreRow?.score ?? 0,
    stars: {
      visionario: lit.has('visionario'),
      mentor: lit.has('mentor'),
      collaboratore: lit.has('collaboratore'),
      creatore: lit.has('creatore'),
      innovatore: lit.has('innovatore'),
      ambasciatore: lit.has('ambasciatore'),
    },
  };
}

/** The rich snapshot (breakdown / peak / computed) for the breakdown UI. Coalesces to zero. */
export async function getAuraScoreFull(
  client: AthanorClient,
  profileId: string,
): Promise<AuraScore> {
  const { data } = await client
    .from('aura_scores')
    .select('profile_id, score, breakdown, peak_score, last_qualifying_action_at, computed_at')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!data) return zeroAuraScore(profileId);
  return {
    profileId: data.profile_id,
    score: data.score,
    breakdown: data.breakdown as AuraScore['breakdown'],
    peakScore: data.peak_score,
    lastQualifyingActionAt: data.last_qualifying_action_at,
    computedAt: data.computed_at,
  };
}

/** Opaque keyset cursor — the last (created_at, id) seen. Never an offset (rule #9). */
export type LedgerCursor = { ts: string; id: string };

/** Filter for the ledger page. */
export type LedgerFilter = 'all' | 'gained' | 'decayed';

/**
 * Owner's ledger, newest-first, keyset on (created_at, id) — never offset (rule #9).
 * RLS scopes to the caller's own events.
 */
export async function getAuraLedgerPage(
  client: AthanorClient,
  profileId: string,
  {
    cursor,
    limit = 20,
    filter = 'all',
  }: { cursor?: LedgerCursor; limit?: number; filter?: LedgerFilter } = {},
): Promise<{ rows: AuraEvent[]; nextCursor: LedgerCursor | null }> {
  let q = client
    .from('aura_events')
    .select('id, profile_id, type, points, ref_id, reason, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (filter === 'gained') q = q.gt('points', 0);
  if (filter === 'decayed') q = q.lt('points', 0);

  if (cursor) {
    const { ts, id } = cursor;
    q = q.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`);
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((r) =>
    auraEventSchema.parse({
      id: r.id,
      profileId: r.profile_id,
      type: r.type,
      points: r.points,
      refId: r.ref_id,
      reason: r.reason,
      createdAt: r.created_at,
    }),
  );

  // A full page means more rows may exist — hand back the last row as the keyset cursor.
  const last = rows.length === limit ? rows.at(-1) : undefined;
  const nextCursor = last ? { ts: last.createdAt, id: last.id } : null;
  return { rows, nextCursor };
}

/**
 * Owner's recent events since `sinceIso` (newest-first, bounded). For the week recap —
 * the app aggregates these client-side via @athanor/core summarizeWeek (display only,
 * rule #1: never a score write). RLS scopes to the caller's own rows. Never offset (#9).
 */
export async function getAuraEventsSince(
  client: AthanorClient,
  profileId: string,
  sinceIso: string,
): Promise<AuraEvent[]> {
  const { data, error } = await client
    .from('aura_events')
    .select('id, profile_id, type, points, ref_id, reason, created_at')
    .eq('profile_id', profileId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r) =>
    auraEventSchema.parse({
      id: r.id,
      profileId: r.profile_id,
      type: r.type,
      points: r.points,
      refId: r.ref_id,
      reason: r.reason,
      createdAt: r.created_at,
    }),
  );
}

/** Stars for a profile (earned-only for others via RLS; own profile sees unearned progress too). */
export async function getStars(client: AthanorClient, profileId: string): Promise<Star[]> {
  const { data, error } = await client
    .from('stars')
    .select('id, profile_id, star_id, granted_at, progress')
    .eq('profile_id', profileId);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    starId: starKeySchema.parse(r.star_id),
    grantedAt: r.granted_at,
    progress: r.progress as Star['progress'],
  }));
}

/**
 * Subscribe an owner to their Aura realtime: aura_scores / aura_events / stars row
 * changes + the engine's celebration broadcast. Returns a cleanup fn (api rule:
 * unsubscribe on unmount). The engine is the only producer — nothing here writes.
 */
export function subscribeAura(
  client: AthanorClient,
  profileId: string,
  handlers: {
    onScore?: (row: unknown) => void;
    onEvent?: (row: unknown) => void;
    onStar?: (row: unknown) => void;
    onCelebration?: (payload: { tier_up?: string; new_stars?: string[] }) => void;
  },
): () => void {
  const channel = client
    .channel(`aura:${profileId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'aura_scores',
        filter: `profile_id=eq.${profileId}`,
      },
      (p) => handlers.onScore?.(p.new),
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'aura_events',
        filter: `profile_id=eq.${profileId}`,
      },
      (p) => handlers.onEvent?.(p.new),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'stars',
        filter: `profile_id=eq.${profileId}`,
      },
      (p) => handlers.onStar?.(p.new),
    )
    .on('broadcast', { event: 'celebration' }, (p) =>
      handlers.onCelebration?.(p.payload as { tier_up?: string; new_stars?: string[] }),
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
