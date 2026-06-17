/**
 * score-engine — M6 Aura engine (service-role only).
 *
 * SOLE writer of: aura_events, aura_scores, stars.
 * Called by per-action award triggers wired at each originating milestone.
 * DORMANT this slice: no trigger is wired yet. `deno check` is the gate.
 *
 * Endpoint: POST /functions/v1/score-engine
 * Body: { profile_id: string; type: ScoringType; ref_id?: string; ctx?: AwardContext }
 */

import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { json, error } from '../_shared/respond.ts';

// Core math via _core.ts shim (rule #10: single-source; see _core.ts for why).
import {
  pointsFor,
  applyCap,
  applyDecay,
  aggregateScore,
  evaluateStars,
  tierOf,
  AURA_CAPS,
  STAR_KEYS,
  type AwardContext,
  type ScoringType,
  type LedgerLine,
  type StarFacts,
  type StarKey,
} from './_core.ts';

// ── Request body ────────────────────────────────────────────────────────────

interface EngineRequest {
  profile_id: string;
  type: ScoringType;
  ref_id?: string;
  ctx?: AwardContext;
}

// ── Cap window helpers ───────────────────────────────────────────────────────

function windowStart(window: string): string {
  const now = new Date();
  switch (window) {
    case 'day':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    case 'lifetime':
      return new Date(0).toISOString();
    default:
      return new Date(0).toISOString();
  }
}

// ── Idle-weeks calculation ───────────────────────────────────────────────────

function idleWeeks(lastActionAt: string | null): number {
  if (!lastActionAt) return 0;
  const last = new Date(lastActionAt).getTime();
  const now = Date.now();
  const diffDays = (now - last) / (1000 * 60 * 60 * 24);
  const IDLE_BEFORE = 30;
  if (diffDays <= IDLE_BEFORE) return 0;
  return Math.floor((diffDays - IDLE_BEFORE) / 7);
}

// ── Star facts gather (v1) ───────────────────────────────────────────────────

async function gatherStarFacts(
  admin: ReturnType<typeof supabaseAdmin>,
  profileId: string,
): Promise<StarFacts> {
  // Count ledger-sourced facts from aura_events.
  const { data: ledger } = await admin
    .from('aura_events')
    .select('type')
    .eq('profile_id', profileId)
    .in('type', ['own_milestone', 'milestone_help', 'momento_conversation']);

  const rows = ledger ?? [];
  const ownMilestonesCompleted = rows.filter((r) => r.type === 'own_milestone').length;
  const helpsCompleted = rows.filter((r) => r.type === 'milestone_help').length;
  const momentoConversations = rows.filter((r) => r.type === 'momento_conversation').length;

  // Composite facts — stubbed until originating milestones wire their triggers.
  // TODO(M6-wire): dreamPublished = query dreams table (M2/M3).
  const dreamPublished = false;
  // TODO(M6-wire): milestonesDefined = count milestones rows (M2).
  const milestonesDefined = 0;
  // TODO(M6-wire): evoluzionePostsStarred = post_reactions on own posts (M3).
  const evoluzionePostsStarred = 0;
  // TODO(M6-wire): distinctStarrers = distinct reactor_id on own posts (M3).
  const distinctStarrers = 0;
  // TODO(M6-wire): invitesActivated = invites table where referrer_id = profileId (M?).
  const invitesActivated = 0;

  return {
    dreamPublished,
    milestonesDefined,
    ownMilestonesCompleted,
    helpsCompleted,
    evoluzionePostsStarred,
    distinctStarrers,
    momentoConversations,
    invitesActivated,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Caller gate: service-role only. verify_jwt=true in config.toml admits any valid
  // project JWT (every member has one) — additionally assert bearer IS service-role key.
  const authz = req.headers.get('Authorization') ?? '';
  const bearer = authz.replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || bearer !== serviceKey) return error('unauthorized', 401);

  let body: EngineRequest;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }

  const { profile_id, type, ref_id, ctx = {} } = body;
  if (!profile_id || typeof profile_id !== 'string') return error('missing profile_id', 400);
  if (!type || typeof type !== 'string') return error('missing type', 400);

  const admin = supabaseAdmin();

  // ── 1. Cap check ────────────────────────────────────────────────────────────

  const cap = (AURA_CAPS as Record<string, { limit: number; window: string }>)[type];

  let withinCap = true;
  if (cap) {
    const since = windowStart(cap.window);
    const { count } = await admin
      .from('aura_events')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile_id)
      .eq('type', type)
      .gte('created_at', since);

    withinCap = applyCap(type, count ?? 0);
  }

  // ── 2. Compute points ───────────────────────────────────────────────────────

  const points = pointsFor(type as ScoringType, { ...ctx, withinCap });
  if (points === 0 && withinCap) {
    // Zero-point non-scoring action (circle/fund/marketplace): nothing to write.
    return json({ awarded: 0, skipped: true });
  }

  // ── 3. Insert ledger row (idempotent on ref_id via unique index) ────────────

  const { error: insertErr } = await admin.from('aura_events').insert({
    profile_id,
    type,
    points,
    ref_id: ref_id ?? null,
    reason: ctx,
  });

  if (insertErr) {
    // Duplicate (ref_id idempotency key already present) → silently skip.
    if (insertErr.code === '23505') return json({ awarded: 0, duplicate: true });
    return error(`ledger insert failed: ${insertErr.message}`, 500);
  }

  // ── 4. Re-aggregate full ledger ─────────────────────────────────────────────

  const { data: allEvents } = await admin
    .from('aura_events')
    .select('type, points')
    .eq('profile_id', profile_id);

  const ledgerLines: LedgerLine[] = (allEvents ?? []).map((e) => ({
    type: e.type as string,
    points: e.points as number,
  }));

  const { score, breakdown } = aggregateScore(ledgerLines);

  // ── 5. Fetch current snapshot for decay + peak ──────────────────────────────

  const { data: snapshot } = await admin
    .from('aura_scores')
    .select('peak_score, last_qualifying_action_at')
    .eq('profile_id', profile_id)
    .maybeSingle();

  const prevPeak = snapshot?.peak_score ?? 0;
  const newPeak = Math.max(prevPeak, score);
  const lastAction = snapshot?.last_qualifying_action_at ?? null;

  // Decay only applies when the current event is NOT a positive Aura action.
  const idle = points > 0 ? 0 : idleWeeks(lastAction);
  const decayedScore = idle > 0 ? applyDecay({ score, peak: newPeak, idleWeeks: idle }) : score;

  const tier = tierOf(decayedScore);

  // ── 6. Upsert aura_scores ───────────────────────────────────────────────────

  const { error: scoreErr } = await admin.from('aura_scores').upsert(
    {
      profile_id,
      score: decayedScore,
      breakdown,
      peak_score: newPeak,
      last_qualifying_action_at: points > 0 ? new Date().toISOString() : lastAction,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  );

  if (scoreErr) return error(`score upsert failed: ${scoreErr.message}`, 500);

  // ── 7. Star evaluation & upsert ─────────────────────────────────────────────

  const facts = await gatherStarFacts(admin, profile_id);
  const { granted, progress } = evaluateStars(facts);

  for (const starId of STAR_KEYS) {
    const isGranted = granted.includes(starId as StarKey);
    const prog = progress[starId as StarKey];
    const { error: starErr } = await admin.from('stars').upsert(
      {
        profile_id,
        star_id: starId,
        granted_at: isGranted ? new Date().toISOString() : null,
        progress: { done: prog.done, total: prog.total, unit: prog.unit },
      },
      { onConflict: 'profile_id,star_id' },
    );
    if (starErr) {
      // Non-fatal: score already committed. Log and continue.
      console.error(`star upsert failed for ${starId}:`, starErr.message);
    }
  }

  // ── 8. Respond ──────────────────────────────────────────────────────────────

  return json({
    awarded: points,
    score: decayedScore,
    tier,
    starsGranted: granted,
  });
});
