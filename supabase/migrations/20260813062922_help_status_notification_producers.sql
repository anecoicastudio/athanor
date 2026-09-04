-- milestone_helps status producers — help accepted + help completed notify the HELPER (#125).
--
-- 20260701160235_m9_notification_producers.sql wired only the offer (AFTER INSERT → dream
-- owner). Its SKIPPED note covered the completion ("needs a new notif.tpl.helpConfirmed");
-- the accept transition was simply absent. Both land here, now that #113's missing-key
-- fallback lets old clients degrade unseen template_keys to notif.tpl.generic.
--
-- Shape: AFTER UPDATE row triggers, mirroring athanor.notify_connection_accepted's
-- `new.status = X and old.status is distinct from X` pattern. Triggers are the only viable
-- producer: accept is a plain client UPDATE (milestone_helps_update_owner policy +
-- milestone_helps_guard legal edges) and complete is public.confirm_milestone_help(), which
-- also issues a plain UPDATE — there is no single RPC choke point covering both.
--
-- Recipient is the helper (the non-actor) on both edges, matching the
-- connection_requests_notify_accepted precedent (only the requester is told). The dream owner
-- performed the transition and needs no echo. `type` reuses 'dreamMilestone' (precedent:
-- notif.tpl.connectionAccepted reuses 'connection'), so the notifications/
-- notification_preferences check constraints and the prefs UI are untouched; the two new
-- template_keys distinguish the copy.
--
-- Both functions call athanor.enqueue_notification (guarded no-op until the fan-out
-- URL/key resolve — Vault-backed since 20260810103721), so neither blocks the source UPDATE.

-- ── 1. accepted: the owner takes the helper up on the offer ────────────────────────────────
create or replace function athanor.notify_milestone_help_accepted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner_handle text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select p.handle into v_owner_handle
      from public.dream_milestones m
      join public.dreams d on d.id = m.dream_id
      join public.profiles p on p.id = d.profile_id
     where m.id = new.milestone_id;
    perform athanor.enqueue_notification(
      new.helper_id, 'dreamMilestone', 'notif.tpl.helpAccepted',
      jsonb_build_object('name', coalesce(v_owner_handle, '')),
      jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_accepted() from public, anon, authenticated;

create trigger milestone_helps_notify_accepted
  after update on public.milestone_helps
  for each row execute function athanor.notify_milestone_help_accepted();

-- ── 2. completed: the owner confirms the help — the +40 helper Aura moment ─────────────────
create or replace function athanor.notify_milestone_help_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner_handle text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select p.handle into v_owner_handle
      from public.dream_milestones m
      join public.dreams d on d.id = m.dream_id
      join public.profiles p on p.id = d.profile_id
     where m.id = new.milestone_id;
    perform athanor.enqueue_notification(
      new.helper_id, 'dreamMilestone', 'notif.tpl.helpConfirmed',
      jsonb_build_object('name', coalesce(v_owner_handle, '')),
      jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_completed() from public, anon, authenticated;

-- AFTER UPDATE on milestone_helps also fires milestone_helps_aura_help (20260701124122, name
-- order 'a' < 'n'). Order-independent by design: the aura trigger writes aura plumbing, these
-- two only read new/old + profiles.handle and enqueue; neither observes the other's effects.
-- Do not add a cross-dependency without making the ordering explicit.
create trigger milestone_helps_notify_completed
  after update on public.milestone_helps
  for each row execute function athanor.notify_milestone_help_completed();
