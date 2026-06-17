-- M6 celebration-realtime — Broadcast-from-DB Aura celebration (backend 09 §2.4/§5.2, C7).
-- The score-engine (sole writer of aura_*) emits a SHAPED celebration payload onto the
-- owner-private topic aura:{profileId}. RLS on realtime.messages makes the topic
-- owner-receive-only and gives clients NO send path (Invariant I3 — celebration cannot
-- be client-forged). Rule #1: no client write to anything Aura.

-- realtime.messages ships RLS-enabled on Supabase; assert it (idempotent, safe locally + hosted).
alter table realtime.messages enable row level security;

-- Receive-only, owner-only: a client may receive broadcasts on aura:{their own uid}.
create policy "rt_aura_owner_receive"
on realtime.messages
for select
to authenticated
using (
  'aura:' || (select auth.uid())::text = (select realtime.topic())
  and realtime.messages.extension = 'broadcast'
);
-- NO client INSERT policy on aura:* — only the engine (service role, via the DEFINER
-- function below) broadcasts. Deny-by-default on realtime.messages handles the rest.

-- The engine's emitter. SECURITY DEFINER so it can call realtime.send regardless of the
-- caller's grants; locked search_path; execute revoked from clients (service_role only).
-- Custom shape (not a row diff), so realtime.send (09 §2.4) not realtime.broadcast_changes.
create or replace function public.broadcast_aura_celebration(
  p_profile_id uuid,
  p_tier_up text default null,
  p_new_stars text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'tier_up', p_tier_up,
      'new_stars', to_jsonb(coalesce(p_new_stars, array[]::text[]))
    ),
    'celebration',                       -- event
    'aura:' || p_profile_id::text,       -- topic (owner-private)
    true                                 -- private
  );
end;
$$;

revoke all on function public.broadcast_aura_celebration(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.broadcast_aura_celebration(uuid, text, text[]) to service_role;
