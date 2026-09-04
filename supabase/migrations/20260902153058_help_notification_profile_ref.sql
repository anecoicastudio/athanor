-- The two helper-directed dreamMilestone notifications carry a ROUTABLE ref (#637 item 3).
--
-- 20260813062922 gave all three help templates `entity_ref = {kind:'milestone_help', id}`, and
-- nothing in the app accepts a milestone_helps id: (modal)/milestone.tsx is the tappa composer,
-- (modal)/help.tsx is the offer composer, (modal)/dream/[id].tsx wants a dream id. So
-- notification-route.ts ignored the ref and sent every dreamMilestone row to (tabs)/profile —
-- which is the DREAM OWNER'S own profile. «Marta ha accettato il tuo aiuto» → tap → your own
-- Aura score.
--
-- The offer is the one arm where that was right: its recipient IS the owner (v_owner), and
-- (tabs)/profile renders their own dream, its tappe and the incoming offers they accept from.
-- It is left exactly as it was. The other two notify the HELPER, and the destination they want
-- is the owner's profile — (modal)/user/[id], which renders that member's dream with each tappa
-- carrying the viewer's own help state (useMyHelpsForDream). So: re-sign those two to carry
-- {kind:'profile', id: <owner>}.
--
-- The ref KIND, not the template_key, is what the router switches on, and that is deliberate:
-- a tapped PUSH carries only {type, route, entity_ref} — no template_key — so a template-keyed
-- rule would route correctly in the notification centre and nowhere from the banner. Rows written
-- before this migration keep kind 'milestone_help' and fall to the old (tabs)/profile arm, which
-- is why the router matches on 'profile' rather than switching wholesale.
--
-- Both bodies are otherwise unchanged from 20260813062922: same guard on the status edge, same
-- `name` param, same SECURITY DEFINER + locked search_path, same trigger bindings (create or
-- replace touches neither the triggers nor the grants).

-- ── 1. accepted ──────────────────────────────────────────────────────────────────────────────
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
      jsonb_build_object('name', coalesce(v_owner_handle, '')),
      -- The fallback is not defensive noise: entityRefSchema requires `id` to be a STRING, and a
      -- jsonb_build_object with a null id parses to {"kind":"profile","id":null}, which the
      -- client's boundary parser withholds — losing the whole notification rather than its route.
      -- An unresolved owner therefore keeps the old ref, which routes somewhere harmless.
      case when v_owner_id is null
           then jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
           else jsonb_build_object('kind', 'profile', 'id', v_owner_id::text)
      end
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_accepted() from public, anon, authenticated;

-- ── 2. completed ─────────────────────────────────────────────────────────────────────────────
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
      jsonb_build_object('name', coalesce(v_owner_handle, '')),
      case when v_owner_id is null
           then jsonb_build_object('kind', 'milestone_help', 'id', new.id::text)
           else jsonb_build_object('kind', 'profile', 'id', v_owner_id::text)
      end
    );
  end if;
  return new;
end; $$;
revoke execute on function athanor.notify_milestone_help_completed() from public, anon, authenticated;
