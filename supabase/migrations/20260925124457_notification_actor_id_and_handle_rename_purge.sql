-- A renamed handle stops living on by value (#800). Ruled on the issue 2026-09-25: purge on
-- rename, keep no history of former handles.
--
-- ── 1. Notifications carry the actor's profile id ────────────────────────────────────────────
-- Six producers write the actor's handle into notifications.params as `name` — five
-- athanor.notify_* functions and public.on_momento_proposal_push, which lives in `public` and is
-- not named notify_* (20260824070529's header lists all six among its single-recipient
-- producers). A handle copied by value never learns about a rename, so every row written before
-- one kept naming the member by the handle they had left — and, once somebody else claimed it,
-- by another member's handle.
--
-- Each now also writes `actor_id`, the actor's profile id, and the app resolves the CURRENT
-- handle from it at render (packages/api listNotifications). `name` stays, for two readers:
--   - push. notification-fan-out forwards params to push-dispatch, and _shared/notif-templates.ts
--     renders the lock-screen text from `name` at send time, when it is correct. A sent push
--     cannot be recalled whichever way this goes.
--   - rows written before this migration, which have no actor_id and render from `name` as
--     they always did.
-- `actor_id` is left out rather than written as JSON null when the actor did not resolve (the
-- two help producers join through the milestone and can come back empty): jsonb_strip_nulls
-- drops it, and a row without it renders exactly like an old row.
--
-- Bodies are otherwise unchanged from their latest definitions (20260701160235 for three and for
-- on_momento_proposal_push, 20260902153058 for the two help producers): same guards, same
-- entity_ref — 0093 asserts the `'kind', 'profile'` / `'kind', 'milestone_help'` text in prosrc
-- — same SECURITY DEFINER with an empty search_path, same revoke. `create or replace` touches
-- neither the trigger bindings nor the grants; the revokes are restated because 0121 reads the
-- migration that last defines a trigger function.

-- ── 1a. milestone_helps offer → dream owner; the actor is the helper ─────────────────────────
create or replace function athanor.notify_milestone_help_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_helper_handle text;
begin
  select d.profile_id into v_owner
    from public.dream_milestones m
    join public.dreams d on d.id = m.dream_id
   where m.id = new.milestone_id;
  if v_owner is null or v_owner = new.helper_id then
    return new; -- missing milestone (shouldn't happen, FK) or self-help (RLS already forbids it)
  end if;
  select handle into v_helper_handle from public.profiles where id = new.helper_id;
  perform athanor.enqueue_notification(
    v_owner, 'dreamMilestone', 'notif.tpl.dreamMilestone',
    jsonb_build_object('name', coalesce(v_helper_handle, ''), 'actor_id', new.helper_id::text),
    jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
  );
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_offer() from public, anon, authenticated;

-- ── 1b. connection request → addressee; the actor is the requester ───────────────────────────
create or replace function athanor.notify_connection_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_requester_handle text;
begin
  select handle into v_requester_handle from public.profiles where id = new.requester_id;
  perform athanor.enqueue_notification(
    new.addressee_id, 'connection', 'notif.tpl.connection',
    jsonb_build_object('name', coalesce(v_requester_handle, ''),
                       'actor_id', new.requester_id::text),
    jsonb_build_object('kind', 'connection_request', 'id', new.id::text)
  );
  return new;
end; $$;
revoke execute on function athanor.notify_connection_request() from public, anon, authenticated;

-- ── 1c. connection accepted → requester; the actor is the addressee ──────────────────────────
create or replace function athanor.notify_connection_accepted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_addressee_handle text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select handle into v_addressee_handle from public.profiles where id = new.addressee_id;
    perform athanor.enqueue_notification(
      new.requester_id, 'connection', 'notif.tpl.connectionAccepted',
      jsonb_build_object('name', coalesce(v_addressee_handle, ''),
                         'actor_id', new.addressee_id::text),
      jsonb_build_object('kind', 'connection', 'id', new.id::text)
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_connection_accepted() from public, anon, authenticated;

-- ── 1d. help accepted → helper; the actor is the dream owner ─────────────────────────────────
create or replace function athanor.notify_milestone_help_accepted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner_id uuid;
  v_owner_handle text;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    select d.profile_id, p.handle into v_owner_id, v_owner_handle
      from public.dream_milestones m
      join public.dreams d on d.id = m.dream_id
      join public.profiles p on p.id = d.profile_id
     where m.id = new.milestone_id;
    perform athanor.enqueue_notification(
      new.helper_id, 'dreamMilestone', 'notif.tpl.helpAccepted',
      jsonb_strip_nulls(jsonb_build_object('name', coalesce(v_owner_handle, ''),
                                           'actor_id', v_owner_id::text)),
      -- entityRefSchema requires `id` to be a STRING (20260902153058): an unresolved owner keeps
      -- the old ref, which routes somewhere harmless.
      case when v_owner_id is null
           then jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
           else jsonb_build_object('kind', 'profile', 'id', v_owner_id::text)
      end
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_accepted() from public, anon, authenticated;

-- ── 1e. help completed → helper; the actor is the dream owner ────────────────────────────────
create or replace function athanor.notify_milestone_help_completed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner_id uuid;
  v_owner_handle text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select d.profile_id, p.handle into v_owner_id, v_owner_handle
      from public.dream_milestones m
      join public.dreams d on d.id = m.dream_id
      join public.profiles p on p.id = d.profile_id
     where m.id = new.milestone_id;
    perform athanor.enqueue_notification(
      new.helper_id, 'dreamMilestone', 'notif.tpl.helpConfirmed',
      jsonb_strip_nulls(jsonb_build_object('name', coalesce(v_owner_handle, ''),
                                           'actor_id', v_owner_id::text)),
      case when v_owner_id is null
           then jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
           else jsonb_build_object('kind', 'profile', 'id', v_owner_id::text)
      end
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_completed() from public, anon, authenticated;

-- ── 1f. momento proposal → the member; the actor is the candidate ────────────────────────────
create or replace function public.on_momento_proposal_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_candidate_handle text;
begin
  select handle into v_candidate_handle from public.profiles where id = new.candidate_id;
  perform athanor.enqueue_notification(
    new.user_id, 'moment', 'notif.tpl.moment',
    jsonb_build_object('name', coalesce(v_candidate_handle, ''),
                       'actor_id', new.candidate_id::text),
    jsonb_build_object('kind', 'momento', 'id', new.id::text)
  );
  return new;
end;
$$;
revoke execute on function public.on_momento_proposal_push() from public, anon, authenticated;

-- ── 1g. Backfill actor_id onto rows already written ─────────────────────────────────────────
-- Without it every notification that exists today keeps naming the actor by a copied handle —
-- the old one after a rename, another member's once the handle is reclaimed, and a blocked
-- member's even though the block hides them everywhere else. Each producer's entity_ref leads
-- back to its actor, so the id is recoverable rather than lost:
--   connection          ref connection_request → connection_requests.requester_id
--   connectionAccepted  ref connection          → connection_requests.addressee_id (the ref id
--                                                  is the request's id, see 1c)
--   dreamMilestone      ref milestone_help      → milestone_helps.helper_id
--   helpAccepted/-Confirmed ref profile         → the ref id itself (the dream owner, #637)
--                           ref milestone_help  → the dream's owner (rows from before #637)
--   moment              ref momento             → momento_proposals.candidate_id
-- A row whose source row is gone stays as it is and renders from `name`, as before. `name` is
-- kept on every row. The ref id is cast to uuid only when it has a uuid's shape, so a malformed
-- one is simply not matched rather than a cast error that aborts the migration.
--
-- The touch trigger is off for the statement: notifications.updated_at records when read_at
-- flipped (#180, 20260821164731), and a backfill is not a read.
alter table public.notifications disable trigger notifications_touch_updated_at;

with actor as (
  select n.id,
         case
           when n.template_key = 'notif.tpl.connection'
                and n.entity_ref ->> 'kind' = 'connection_request'
             then (select cr.requester_id from public.connection_requests cr
                    where cr.id = n.ref_id)
           when n.template_key = 'notif.tpl.connectionAccepted'
                and n.entity_ref ->> 'kind' = 'connection'
             then (select cr.addressee_id from public.connection_requests cr
                    where cr.id = n.ref_id)
           when n.template_key = 'notif.tpl.dreamMilestone'
                and n.entity_ref ->> 'kind' = 'milestone_help'
             then (select mh.helper_id from public.milestone_helps mh
                    where mh.id = n.ref_id)
           when n.template_key in ('notif.tpl.helpAccepted', 'notif.tpl.helpConfirmed')
                and n.entity_ref ->> 'kind' = 'profile'
             then (select p.id from public.profiles p where p.id = n.ref_id)
           when n.template_key in ('notif.tpl.helpAccepted', 'notif.tpl.helpConfirmed')
                and n.entity_ref ->> 'kind' = 'milestone_help'
             then (select d.profile_id from public.milestone_helps mh
                     join public.dream_milestones m on m.id = mh.milestone_id
                     join public.dreams d on d.id = m.dream_id
                    where mh.id = n.ref_id)
           when n.template_key = 'notif.tpl.moment' and n.entity_ref ->> 'kind' = 'momento'
             then (select mp.candidate_id from public.momento_proposals mp
                    where mp.id = n.ref_id)
         end as actor_id
    from (select n0.id, n0.template_key, n0.entity_ref,
                 case when n0.entity_ref ->> 'id'
                           ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then (n0.entity_ref ->> 'id')::uuid
                 end as ref_id
            from public.notifications n0
           where n0.params ? 'name'
             and not n0.params ? 'actor_id') n
)
update public.notifications n
   set params = n.params || jsonb_build_object('actor_id', a.actor_id::text)
  from actor a
 where a.id = n.id
   and a.actor_id is not null;

alter table public.notifications enable trigger notifications_touch_updated_at;

-- ── 2. A rename purges the old address from the web cache ────────────────────────────────────
-- apps/web caches /@handle and its OG card in the OpenNext KV incremental cache, and neither a
-- rename nor a deploy removes them (RELEASE-RUNBOOK §7.4): a deploy strands the entries under a
-- dead BUILD_ID prefix, where they stay readable by key with the member's photo, name and dream
-- quote. erasure-job already sweeps every prefix for a handle (_shared/kv-purge.ts); the
-- handle-rename-purge edge function runs the same sweep for the handle a member just left.
--
-- AFTER UPDATE OF handle, and only on a CHANGE FROM a handle: the first choice (old.handle NULL,
-- #782) had no page to purge. AFTER, not BEFORE, so a rename refused by profiles_handle_cooldown
-- or a constraint never purges — and pg_net's queue row is written in this transaction, so a
-- rename that rolls back later sends nothing either. Every write path reaches it: a member's
-- PostgREST UPDATE (claimHandle) and an operator's service-role one alike.
--
-- SECURITY DEFINER because the trigger fires as the renaming member (`authenticated`), who can
-- neither execute athanor.runtime_setting (revoked, it reads Vault) nor call net.http_post.
-- It sends the OLD handle and nothing else — no profile id, so the request body names no member
-- beyond a handle that has just been released.
--
-- Fail-open, like enqueue_media_process: a missing Vault pair is a quiet no-op and a pg_net
-- error is swallowed, because a cache purge must never fail the rename that caused it. The
-- purge's own outcome is recorded only as the function's response status in
-- net._http_response (503 unconfigured, 502 incomplete) — see the edge function.
--
-- Vault pair, set per project by the operator (rule 8 — never in a migration):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/handle-rename-purge',
--                              'app.settings.handle_rename_purge_url');
--   select vault.create_secret('sb_secret_…', 'app.settings.handle_rename_purge_key');
create or replace function athanor.enqueue_handle_rename_purge() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := athanor.runtime_setting('handle_rename_purge_url');
  v_key text := athanor.runtime_setting('handle_rename_purge_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return null; -- purge not configured on this project → no-op, never block the rename
  end if;
  begin
    perform net.http_post(
      url := v_url,
      headers := athanor.edge_auth_headers(v_key),
      body := jsonb_build_object('handle', old.handle),
      -- 30 s, as invoke_erasure_job: the sweep lists the whole cache namespace by prefix.
      timeout_milliseconds := 30000
    );
  exception when others then
    null; -- enqueue failure must never fail the rename (fail-open)
  end;
  return null; -- AFTER trigger: the return value is ignored
end; $$;

comment on function athanor.enqueue_handle_rename_purge() is
  'AFTER UPDATE OF handle on profiles (#800): posts the handle a member renamed away from to the '
  'handle-rename-purge edge function, which drops /@old and its OG card from the web cache. '
  'No-op until app.settings.handle_rename_purge_url/_key exist in Vault; fail-open.';

-- #409: born executable by PUBLIC, anon and authenticated like every function; a trigger fn
-- needs none of it (EXECUTE is checked when the trigger is created, not when it fires).
revoke execute on function athanor.enqueue_handle_rename_purge() from public, anon, authenticated;

create trigger profiles_handle_rename_purge
  after update of handle on public.profiles
  for each row
  when (old.handle is not null and new.handle is distinct from old.handle)
  execute function athanor.enqueue_handle_rename_purge();
