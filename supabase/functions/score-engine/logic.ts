import { z } from 'zod';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, error } from '../_shared/respond.ts';

// Core math — imported directly from packages/core (sloppy-imports resolves extension-less).
import { pointsFor, type AwardContext } from '../../../packages/core/src/score/award.ts';
import { applyCap } from '../../../packages/core/src/score/caps.ts';
import { applyDecay } from '../../../packages/core/src/score/decay.ts';
import { aggregateScore, type LedgerLine } from '../../../packages/core/src/score/aggregate.ts';
import { evaluateStars, type StarFacts } from '../../../packages/core/src/score/stars.ts';
import { tierOf } from '../../../packages/core/src/score/tier.ts';
import { AURA_CAPS, DECAY, type ScoringType } from '../../../packages/core/src/score/weights.ts';
import { STAR_KEYS, type StarKey } from '../../../packages/schemas/src/aura.ts';

// Award/decay engine extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS, requireServiceRole, body parse,
// client construction, deploy-asset pins) and injects everything here
// (repo convention: DI over mocks). Clock injected via ctx.now (core rule: no bare Date).

export type ScoreCtx = {
  /** service role — SOLE writer of aura_events / aura_scores / stars (rule #1) */
  admin: SupabaseClient;
  /** injected clock — index.ts wires () => new Date(); tests pin a fixed instant */
  now: () => Date;
};

// ── Request schema (discriminated union) ────────────────────────────────────

const awardSchema = z.object({
  mode: z.literal('award'),
  profileId: z.string().uuid(),
  type: z.string(), // validated as ScoringType downstream; zod enum would need duplication
  refId: z.string().uuid().optional(),
  ctx: z.record(z.unknown()).optional(),
});

const decaySchema = z.object({
  mode: z.literal('decay'),
});

export const bodySchema = z.union([awardSchema, decaySchema]);

export type AwardInput = z.infer<typeof awardSchema>;

// ── Cap window helpers ───────────────────────────────────────────────────────

export function windowStart(window: string, now: Date): string {
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

// ── Star facts gather (v1) ───────────────────────────────────────────────────

export async function gatherStarFacts(
  admin: SupabaseClient,
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

  // Composite facts — all five now wired from their originating tables.

  // Dreams — feeds dreamPublished and scopes milestonesDefined. A dream has no
  // "draft" state (status is 'active'|'archived'), so an active, non-deleted
  // dream IS a published dream.
  const { data: dreamsRows } = await admin
    .from('dreams')
    .select('id')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .is('deleted_at', null);
  const dreamIds = (dreamsRows ?? []).map((d) => d.id);
  const dreamPublished = dreamIds.length > 0;

  // milestonesDefined — non-deleted tappe on those active dreams.
  let milestonesDefined = 0;
  if (dreamIds.length > 0) {
    const { count } = await admin
      .from('dream_milestones')
      .select('id', { count: 'exact', head: true })
      .in('dream_id', dreamIds)
      .is('deleted_at', null);
    milestonesDefined = count ?? 0;
  }

  // Own Evoluzione posts and their reactions — feeds evoluzionePostsStarred
  // (distinct own posts that received ✦; Visionario ≥10, Innovatore ≥5) and
  // distinctStarrers (distinct reactors, Innovatore ≥10). Self-reactions excluded:
  // reputation is earned through others' real actions, never self-inflated.
  const { data: myPosts } = await admin
    .from('posts')
    .select('id')
    .eq('author_id', profileId)
    .eq('category', 'evolution')
    .is('deleted_at', null);
  const postIds = (myPosts ?? []).map((p) => p.id);

  let evoluzionePostsStarred = 0;
  let distinctStarrers = 0;
  if (postIds.length > 0) {
    const { data: reactions } = await admin
      .from('post_reactions')
      .select('post_id, person_id')
      .in('post_id', postIds)
      .neq('person_id', profileId);
    const rr = reactions ?? [];
    evoluzionePostsStarred = new Set(rr.map((r) => r.post_id)).size;
    distinctStarrers = new Set(rr.map((r) => r.person_id)).size;
  }

  // invitesActivated — activated referral rows (P4.1). Zero Aura points (rule #1):
  // Ambasciatore is a counted composite star (07 §709), no ledger type exists.
  const { count: invitesCount } = await admin
    .from('invites')
    .select('id', { count: 'exact', head: true })
    .eq('inviter_id', profileId)
    .not('activated_at', 'is', null);
  const invitesActivated = invitesCount ?? 0;

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

// ══════════════════════════════════════════════════════════════════
// DECAY MODE — nightly cron; no profileId required
// ══════════════════════════════════════════════════════════════════

export async function runDecay(ctx: ScoreCtx): Promise<Response> {
  const { admin } = ctx;

  const idleThreshold = new Date(
    ctx.now().getTime() - DECAY.IDLE_DAYS_BEFORE * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: stale } = await admin
    .from('aura_scores')
    .select('profile_id, score, peak_score, last_qualifying_action_at')
    .lt('last_qualifying_action_at', idleThreshold);

  let decayed = 0;
  for (const row of stale ?? []) {
    const { profile_id, score, peak_score, last_qualifying_action_at } = row as {
      profile_id: string;
      score: number;
      peak_score: number;
      last_qualifying_action_at: string | null;
    };

    if (!last_qualifying_action_at) continue;
    const diffMs = ctx.now().getTime() - new Date(last_qualifying_action_at).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const idleWeeks = Math.floor((diffDays - DECAY.IDLE_DAYS_BEFORE) / 7);
    if (idleWeeks <= 0) continue;

    // Compute stable base from NON-decay ledger rows so that:
    //   target = base × 0.98^idleWeeks  (linear, spec §4.9 ×0.98/week)
    // A same-night re-run produces the identical target → target < score is false
    // → no new row appended (idempotent per night, backend-07 §476).
    const { data: events } = await admin
      .from('aura_events')
      .select('type, points')
      .eq('profile_id', profile_id);

    const baseScore = aggregateScore(
      (events ?? [])
        .filter((e) => e.type !== 'decay')
        .map((e) => ({ type: e.type as string, points: e.points as number })),
    ).score;

    const target = applyDecay({ score: baseScore, peak: peak_score, idleWeeks });
    if (target >= score) continue; // already at or below target (idempotent guard)

    const pointsDelta = target - score; // negative

    // Append a decay ledger row.
    await admin.from('aura_events').insert({
      profile_id,
      type: 'decay',
      points: pointsDelta,
      ref_id: null,
      reason: { weeks: idleWeeks },
    });

    // Update score — do NOT touch peak_score or last_qualifying_action_at.
    await admin
      .from('aura_scores')
      .update({ score: target, computed_at: ctx.now().toISOString() })
      .eq('profile_id', profile_id);

    decayed++;
  }

  return json({ decayed });
}

// ══════════════════════════════════════════════════════════════════
// AWARD MODE
// ══════════════════════════════════════════════════════════════════

export async function runAward(ctx: ScoreCtx, input: AwardInput): Promise<Response> {
  const { admin } = ctx;
  const { profileId: profile_id, type, refId: ref_id, ctx: reason = {} } = input;
  const awardCtx = reason as AwardContext;

  // ── 1. Cap check ────────────────────────────────────────────────────────────

  const cap = (AURA_CAPS as Record<string, { limit: number; window: string }>)[type];
  let withinCap = true;

  if (cap) {
    const since = windowStart(cap.window, ctx.now());
    const { count } = await admin
      .from('aura_events')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile_id)
      .eq('type', type)
      .gte('created_at', since);

    withinCap = applyCap(type, count ?? 0);
  }

  // I1: if over cap, return immediately without inserting any ledger row.
  if (!withinCap) return json({ capped: true });

  // ── 2. Dampening (pairExchangeIndex) ────────────────────────────────────────

  let pairExchangeIndex: number | undefined;
  if ((type === 'milestone_help' || type === 'momento_conversation') && ref_id) {
    const { count: priorPair } = await admin
      .from('aura_events')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile_id)
      .eq('type', type)
      .eq('ref_id', ref_id);
    pairExchangeIndex = (priorPair ?? 0) + 1;
  }

  // ── 3. Compute points ───────────────────────────────────────────────────────

  const points = pointsFor(type as ScoringType, { ...awardCtx, withinCap, pairExchangeIndex });
  if (points === 0 && withinCap) {
    // Zero-point non-scoring action (circle/fund/marketplace): nothing to write.
    return json({ awarded: 0, skipped: true });
  }

  // ── 4. Idempotent insert ledger row (on conflict ref_id unique index → duplicate) ──

  const { error: insertErr } = await admin.from('aura_events').insert({
    profile_id,
    type,
    points,
    ref_id: ref_id ?? null,
    reason: awardCtx,
  });

  if (insertErr) {
    if (insertErr.code === '23505') return json({ awarded: 0, duplicate: true });
    return error(`ledger insert failed: ${insertErr.message}`, 500);
  }

  // ── 5. Fetch current snapshot (for peak + tier comparison) ─────────────────

  const { data: snapshot } = await admin
    .from('aura_scores')
    .select('score, peak_score, last_qualifying_action_at')
    .eq('profile_id', profile_id)
    .maybeSingle();

  const oldScore = snapshot?.score ?? 0;
  const prevPeak = snapshot?.peak_score ?? 0;

  // ── 6. Full re-aggregation ───────────────────────────────────────────────────

  const { data: allEvents } = await admin
    .from('aura_events')
    .select('type, points')
    .eq('profile_id', profile_id);

  const ledgerLines: LedgerLine[] = (allEvents ?? []).map((e) => ({
    type: e.type as string,
    points: e.points as number,
  }));

  const { score: newScore, breakdown } = aggregateScore(ledgerLines);
  const newPeak = Math.max(prevPeak, newScore);

  // ── 7. Upsert aura_scores ───────────────────────────────────────────────────

  const { error: scoreErr } = await admin.from('aura_scores').upsert(
    {
      profile_id,
      score: newScore,
      breakdown,
      peak_score: newPeak,
      last_qualifying_action_at: ctx.now().toISOString(),
      computed_at: ctx.now().toISOString(),
    },
    { onConflict: 'profile_id' },
  );

  if (scoreErr) return error(`score upsert failed: ${scoreErr.message}`, 500);

  // ── 8. Star evaluation & upsert (I3: preserve granted_at) ──────────────────

  // Fetch existing stars to preserve already-earned grant dates.
  const { data: existingStars } = await admin
    .from('stars')
    .select('star_id, granted_at')
    .eq('profile_id', profile_id);

  const existingGrantedAt = new Map<string, string | null>(
    (existingStars ?? []).map((s: { star_id: string; granted_at: string | null }) => [
      s.star_id,
      s.granted_at,
    ]),
  );

  const facts = await gatherStarFacts(admin, profile_id);
  const { granted, progress } = evaluateStars(facts);

  const now = ctx.now().toISOString();
  const newStars: StarKey[] = [];

  for (const starId of STAR_KEYS) {
    const isGranted = granted.includes(starId as StarKey);
    const prog = progress[starId as StarKey];
    const prevGrantedAt = existingGrantedAt.get(starId) ?? null;

    // I3: never clear an already-earned star's grant date.
    let grantedAt: string | null;
    if (prevGrantedAt !== null) {
      // Already earned before → preserve the original grant date.
      grantedAt = prevGrantedAt;
    } else if (isGranted) {
      // Newly earned this run.
      grantedAt = now;
      newStars.push(starId as StarKey);
    } else {
      grantedAt = null;
    }

    const { error: starErr } = await admin.from('stars').upsert(
      {
        profile_id,
        star_id: starId,
        granted_at: grantedAt,
        progress: { done: prog.done, total: prog.total, unit: prog.unit },
      },
      { onConflict: 'profile_id,star_id' },
    );
    if (starErr) {
      // Non-fatal: score already committed. Log and continue.
      console.error(`star upsert failed for ${starId}:`, starErr.message);
    }
  }

  // ── 9. I2: Celebration broadcast (Broadcast-from-DB, owner-private) ───────────
  // The engine knows old vs new tier + which stars were newly granted; it emits the
  // shaped payload via the SECURITY DEFINER RPC, which calls realtime.send onto the
  // private aura:{id} topic (09 §2.4). Service-role-only; clients can never forge it.

  const tierUp =
    tierOf(newScore) !== tierOf(oldScore) && newScore > oldScore ? tierOf(newScore) : undefined;

  if (tierUp !== undefined || newStars.length > 0) {
    const { error: broadcastErr } = await admin.rpc('broadcast_aura_celebration', {
      p_profile_id: profile_id,
      p_tier_up: tierUp ?? null,
      p_new_stars: newStars.length > 0 ? newStars : null,
    });
    if (broadcastErr) {
      // Non-fatal — score and stars already committed.
      console.error('celebration broadcast failed:', broadcastErr.message);
    }
  }

  // ── 10. Respond ─────────────────────────────────────────────────────────────

  return json({
    awarded: points,
    score: newScore,
    tier: tierOf(newScore),
    starsGranted: granted,
  });
}
