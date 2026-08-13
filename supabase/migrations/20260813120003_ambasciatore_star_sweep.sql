-- Ambasciatore star for invite-only profiles (issue #121).
--
-- Invite activation confers ZERO Aura points and has no aura_events type (rule #1),
-- so it never passes through the score-engine's award mode — and star evaluation
-- lived only there. A member whose sole activity is inviting could hold 5 activated
-- invites and never light Ambasciatore. Fix: enqueue a stars-only engine run
-- ({ mode: 'stars' }) whenever an invites row becomes activated. The stars mode
-- writes ONLY the stars table — never aura_events / aura_scores — so rule #1 holds.
--
-- Mirrors the athanor.enqueue_score_award pattern (20260810103721): URL/key via
-- athanor.runtime_setting (GUC first for the local stack + pgTAP, else Vault),
-- unconfigured → no-op, and the secret rides athanor.edge_auth_headers — the
-- apikey header, never a hand-built Authorization bearer, because a new-style
-- sb_secret_… key is not a JWT and the platform rejects it when sent as one.

create function athanor.enqueue_star_sweep(p_profile uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_url text := athanor.runtime_setting('score_engine_url');
  v_key text := athanor.runtime_setting('score_engine_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- engine not configured (pre-deploy) → no-op, never block the write
  end if;
  perform net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object('mode', 'stars', 'profileId', p_profile),
    timeout_milliseconds := 5000
  );
end;
$$;

comment on function athanor.enqueue_star_sweep(uuid) is
  'Fire-and-forget POST { mode: stars } to the score-engine for one profile. SECURITY DEFINER because it resolves the engine key via athanor.runtime_setting (Vault is readable only by postgres/service_role); execute is revoked from all client roles.';

revoke all on function athanor.enqueue_star_sweep(uuid) from public, anon, authenticated;

create function athanor.star_sweep_invite_activated()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  begin
    perform athanor.enqueue_star_sweep(new.inviter_id);
  exception when others then
    -- Fail-open ON PURPOSE, unlike the bare aura_award_* trigger bodies: every
    -- writer of invites (athanor.redeem_referral) swallows errors with `when
    -- others then null`, so an exception here would not surface — it would
    -- silently roll back the invite row itself. Losing one star sweep is
    -- recoverable (the next award run re-evaluates); losing the activation isn't.
    null;
  end;
  return new;
end;
$$;

comment on function athanor.star_sweep_invite_activated() is
  'AFTER trigger on public.invites: enqueues a stars-only score-engine run for the inviter when a row becomes activated. SECURITY DEFINER to reach athanor.enqueue_star_sweep (client roles have no execute on it); fail-open so an enqueue error never rolls back the invite.';

revoke all on function athanor.star_sweep_invite_activated() from public, anon, authenticated;

-- Two triggers because an INSERT trigger's WHEN clause cannot reference OLD.
-- Today the sole writer (athanor.redeem_referral) INSERTs with activated_at
-- already set, so _ins is the live path; _upd future-proofs a pending→activated
-- flip and its WHEN keeps re-touches of an already-activated row silent.

create trigger invites_star_sweep_ins
  after insert on public.invites
  for each row
  when (new.activated_at is not null)
  execute function athanor.star_sweep_invite_activated();

create trigger invites_star_sweep_upd
  after update of activated_at on public.invites
  for each row
  when (old.activated_at is null and new.activated_at is not null)
  execute function athanor.star_sweep_invite_activated();
