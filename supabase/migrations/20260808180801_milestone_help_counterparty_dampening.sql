-- Make the pairwise dampening actually pairwise.
--
-- docs/PRD.md:181 makes milestone help +40 and UNCAPPED. Its only stated defence is the
-- integrity rule at :184 — "reciprocal exchanges dampened (pairwise diminishing returns)".
-- The engine implements that by counting the awardee's prior events of the same type with the
-- same `ref_id` (score-engine/logic.ts), and for milestone_help `ref_id` is the milestone_helps
-- ROW id. Every help is a fresh row, so the exchange index was permanently 1 and the dampening
-- never fired: two colluding accounts confirm each other's fabricated milestones and collect the
-- full +40 indefinitely, reaching the 1000 clamp in ~25 exchanges and farming the Mentor and
-- Creatore stars on the way.
--
-- The dampening key has to be the COUNTERPARTY, not the artifact. `aura_events` had nowhere to
-- record one, so this adds the column and threads it through the enqueue path. The curve itself
-- (packages/core/src/score/dampen.ts, 1/(1+k(n-1))) was already correct and is untouched.
--
-- momento_conversation was already keyed correctly — its `ref_id` is the conversation, which IS
-- the pair — and is threaded here only so both two-sided types carry the same field.

alter table public.aura_events
  add column counterparty_id uuid references public.profiles (id) on delete set null;

comment on column public.aura_events.counterparty_id is
  'The other party in a two-sided earning event (milestone_help: the dream owner who confirmed; momento_conversation: the other participant). NULL for solo events (identity_verified, own_milestone, event_*, post_starred, report_upheld, decay). Read by the score engine for pairwise diminishing returns per PRD 4.9 — written only by the engine, never client-writable (rule #1).';

-- Supports the engine's dampening count: "how many times has this member already been awarded
-- this type against this counterparty".
create index aura_events_pair
  on public.aura_events (profile_id, type, counterparty_id)
  where counterparty_id is not null;

-- ── enqueue, now carrying the counterparty ──────────────────────────────────
-- A new 5-arg overload rather than a replacement: the 4-arg form stays for the solo award
-- paths (report_upheld, own_milestone, event_*, post_starred), which have no counterparty.
create or replace function athanor.enqueue_score_award(
  p_profile uuid, p_type text, p_ref uuid, p_severity text, p_counterparty uuid
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
      'ctx', jsonb_build_object('severity', p_severity))
  );
end; $$;
revoke execute on function athanor.enqueue_score_award(uuid, text, uuid, text, uuid)
  from public, anon, authenticated;

-- ── milestone_help: the counterparty is the dream owner who confirmed ───────
create or replace function athanor.aura_award_milestone_help() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    -- The confirming owner is the collusion partner: help -> milestone -> dream -> profile.
    select d.profile_id into v_owner
      from public.dream_milestones m
      join public.dreams d on d.id = m.dream_id
      where m.id = new.milestone_id;
    perform athanor.enqueue_score_award(new.helper_id, 'milestone_help', new.id, null, v_owner);
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_milestone_help() from public, anon, authenticated;

-- ── momento_conversation: each side's counterparty is the other participant ──
create or replace function athanor.aura_award_momento_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_a uuid; v_b uuid; v_from_a int; v_from_b int;
begin
  if new.kind <> 'user' or new.sender_id is null then return new; end if;
  select c.participant_a, c.participant_b into v_a, v_b
    from public.conversations c where c.id = new.conversation_id;
  if v_a is null then return new; end if;
  select count(*) filter (where m.sender_id = v_a),
         count(*) filter (where m.sender_id = v_b)
    into v_from_a, v_from_b
    from public.messages m
    where m.conversation_id = new.conversation_id and m.kind = 'user' and m.deleted_at is null;
  -- Unchanged guard (see 20260701124122): total >=10 user messages with both parties present.
  if (v_from_a + v_from_b) >= 10 and v_from_a >= 1 and v_from_b >= 1 then
    perform athanor.enqueue_score_award(v_a, 'momento_conversation', new.conversation_id, null, v_b);
    perform athanor.enqueue_score_award(v_b, 'momento_conversation', new.conversation_id, null, v_a);
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_momento_conversation() from public, anon, authenticated;
