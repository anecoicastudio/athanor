-- M6 Aura award triggers — wire the source tables to the (guarded, no-op-until-deploy)
-- engine enqueue. Triggers ONLY call athanor.enqueue_score_award; they NEVER write aura_*
-- (rule #1). Point VALUES live in packages/core ENGINE_WEIGHTS (rule #10) — the SQL passes
-- only the ScoringType string; the engine resolves the weight. Idempotency: engine dedups
-- on aura_events unique (profile_id, type, ref_id).

-- 1. own_milestone (+10): owner completes a tappa (direct, or via confirm_milestone_help
--    which sets dream_milestones.status='done').
create function athanor.aura_award_own_milestone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    select d.profile_id into v_owner from public.dreams d where d.id = new.dream_id;
    if v_owner is not null then
      perform athanor.enqueue_score_award(v_owner, 'own_milestone', new.id, null);
    end if;
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_own_milestone() from public, anon, authenticated;
create trigger dream_milestones_aura_own after update on public.dream_milestones
  for each row execute function athanor.aura_award_own_milestone();

-- 2. milestone_help (+40): owner confirms a help → award the helper.
create function athanor.aura_award_milestone_help() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform athanor.enqueue_score_award(new.helper_id, 'milestone_help', new.id, null);
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_milestone_help() from public, anon, authenticated;
create trigger milestone_helps_aura_help after update on public.milestone_helps
  for each row execute function athanor.aura_award_milestone_help();

-- 3. post_starred (+2): a ✦ from a member whose Aura > 300 (REACTION_AUTHOR_MIN_SCORE,
--    packages/core weights.ts) → award the post author. Never self-award.
create function athanor.aura_award_post_starred() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_author uuid; v_reactor_score int;
begin
  select p.author_id into v_author from public.posts p where p.id = new.post_id;
  if v_author is null or v_author = new.person_id then
    return new; -- missing post or self-reaction → no award
  end if;
  select s.score into v_reactor_score from public.aura_scores s where s.profile_id = new.person_id;
  if coalesce(v_reactor_score, 0) > 300 then  -- REACTION_AUTHOR_MIN_SCORE (core weights.ts)
    perform athanor.enqueue_score_award(v_author, 'post_starred', new.id, null);
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_post_starred() from public, anon, authenticated;
create trigger post_reactions_aura_starred after insert on public.post_reactions
  for each row execute function athanor.aura_award_post_starred();

-- 4+5. event_attended (+15, every check-in → attendee) AND event_organized (+30, when the
--      event first reaches >=5 check-ins → organizer once). Both fire on event_attendance INSERT.
create function athanor.aura_award_event_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_attendee uuid; v_count int; v_organizer uuid;
begin
  -- attended: resolve the ticket holder. NOTE: the plan's "resolved schema" table names this
  -- table `tickets`; the actual table (20260615232924_event_tickets.sql) is `event_tickets`
  -- (column `user_id` is correct) — corrected here against ground truth.
  select tk.user_id into v_attendee from public.event_tickets tk where tk.id = new.ticket_id;
  if v_attendee is not null then
    perform athanor.enqueue_score_award(v_attendee, 'event_attended', new.id, null);
  end if;
  -- organized: award the organizer once, when attendance reaches >=5 (PRD §4.9). Deliberately
  -- ">=5" not "=5": the engine dedups on (organizer,'event_organized',event_id), so ">=5"
  -- over-fires harmlessly (deduped) whereas "=5" can PERMANENTLY MISS the +30 if a bulk/
  -- concurrent event_attendance insert makes no single AFTER-ROW trigger observe exactly 5.
  select count(*) into v_count from public.event_attendance where event_id = new.event_id;
  if v_count >= 5 then
    select e.organizer_id into v_organizer from public.events e where e.id = new.event_id;
    if v_organizer is not null then
      perform athanor.enqueue_score_award(v_organizer, 'event_organized', new.event_id, null);
    end if;
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_event_attendance() from public, anon, authenticated;
create trigger event_attendance_aura after insert on public.event_attendance
  for each row execute function athanor.aura_award_event_attendance();

-- 6. momento_conversation (+5 each): a conversation reaching >=10 user messages with BOTH
--    sides contributing → award both participants. Over-fires past the 10th msg; engine dedups.
--
--    SEMANTICS DECISION (plan Task 1 Step 3): spec language is consistently "≥10 messages
--    both sides" / "≥10 messages from both sides" (PRD.md §4.9 table + flow diagram;
--    07-score-engine.md §3.1 weights.ts comment + §4 award-trigger map; 05-schema-momenti.md
--    §3; frontend 05-m5-momenti.md — e.g. "Once a conversation reaches ≥10 messages from
--    both sides, each party earns +5 Aura"). Nowhere does the spec say "10 EACH" / "per side"
--    / "20 total" — the recurring phrasing pairs "both sides" with a single ≥10 total, i.e.
--    "both sides" qualifies genuine two-way participation (not a one-sided monologue), not a
--    per-side quota. Chosen guard: total >=10 user messages AND both sides have contributed
--    >=1 message each.
create function athanor.aura_award_momento_conversation() returns trigger
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
  -- PRD §4.9 "reaching >=10 messages from both sides": total >=10 with both parties present.
  if (v_from_a + v_from_b) >= 10 and v_from_a >= 1 and v_from_b >= 1 then
    perform athanor.enqueue_score_award(v_a, 'momento_conversation', new.conversation_id, null);
    perform athanor.enqueue_score_award(v_b, 'momento_conversation', new.conversation_id, null);
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_momento_conversation() from public, anon, authenticated;
create trigger messages_aura_momento after insert on public.messages
  for each row execute function athanor.aura_award_momento_conversation();

-- 7. identity_verified (+50, lifetime): profiles.identity_verified false->true (set by the
--    Stripe Identity webhook, service role). ref = profile id.
create function athanor.aura_award_identity_verified() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.identity_verified = true and old.identity_verified is distinct from true then
    perform athanor.enqueue_score_award(new.id, 'identity_verified', new.id, null);
  end if;
  return new;
end; $$;
revoke execute on function athanor.aura_award_identity_verified() from public, anon, authenticated;
create trigger profiles_aura_identity after update on public.profiles
  for each row execute function athanor.aura_award_identity_verified();
