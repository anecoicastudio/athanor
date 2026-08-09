-- #27 — a ✦ awarded 0: the trigger read the reactor's Aura, gated on it in SQL, then
-- called an enqueue_score_award overload with no parameter to carry it. The pg_net body
-- reached score-engine with ctx = {severity: null}, core's pointsFor saw reviewerScore
-- undefined, `?? 0` failed the gate a second time, and every ✦ returned
-- {awarded: 0, skipped: true} with no aura_events row (see MIGRATIONS-ERRATA.md on
-- 20260701124122). This plumbs the score through, and while here removes the SQL copy of
-- the gate: the threshold lived in two places (a literal `> 300` here, and
-- REACTION_AUTHOR_MIN_SCORE in packages/core/src/score/weights.ts), which is exactly the
-- rule #10 drift this repo forbids. The engine is now the single authority — the trigger
-- always enqueues and always sends the score it read; a sub-gate ✦ costs one no-op engine
-- call and awards nothing, decided by core's pointsFor alone.
--
-- Product call (2026-08-09, pre-deploy): a ✦ is worth the documented {3, 4} band —
-- base 2 × reviewerWeight(reactor score), gated strictly above 300. Sequenced before the
-- hosted deploy so the ledger never has a zero-award era.

-- ── enqueue, now carrying the reactor's score ───────────────────────────────
-- A third overload rather than a replacement, same append pattern as the 5-arg
-- counterparty form (20260808180801): the 4-arg and 5-arg callers are solo/pair paths
-- with no reviewer and stay as they are. Only post_starred calls this one.
create function athanor.enqueue_score_award(
  p_profile uuid, p_type text, p_ref uuid, p_severity text, p_counterparty uuid,
  p_reviewer_score int
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text := current_setting('app.settings.score_engine_url', true);
  v_key text := current_setting('app.settings.score_engine_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- engine not configured (pre-deploy) → no-op, never block the write
  end if;
  perform net.http_post(
    url := v_url,
    -- athanor.edge_auth_headers, never a hand-built Authorization bearer: a new-style
    -- sb_secret_… key is not a JWT and the platform rejects it when sent as one.
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'mode','award','profileId',p_profile,'type',p_type,'refId',p_ref,
      'counterpartyId', p_counterparty,
      'ctx', jsonb_build_object('severity', p_severity, 'reviewerScore', p_reviewer_score))
  );
end; $$;
revoke execute on function athanor.enqueue_score_award(uuid, text, uuid, text, uuid, int)
  from public, anon, authenticated;

-- ── post_starred: send the score, gate nowhere but the engine ───────────────
create or replace function athanor.aura_award_post_starred() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_author uuid; v_reactor_score int;
begin
  select p.author_id into v_author from public.posts p where p.id = new.post_id;
  if v_author is null or v_author = new.person_id then
    return new; -- missing post or self-reaction → no award
  end if;
  select s.score into v_reactor_score from public.aura_scores s where s.profile_id = new.person_id;
  -- No threshold check here: core pointsFor (REACTION_AUTHOR_MIN_SCORE) is the only gate.
  -- A reactor with no aura_scores row is a score of 0 — sent explicitly, never null, so
  -- the engine's `?? 0` default is a dead branch rather than the production path.
  perform athanor.enqueue_score_award(
    v_author, 'post_starred', new.id, null, null, coalesce(v_reactor_score, 0));
  return new;
end; $$;
revoke execute on function athanor.aura_award_post_starred() from public, anon, authenticated;
