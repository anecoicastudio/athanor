-- Enrich push params: populate {name} (and {preview} for messages) so the dispatched
-- body is not contentless. Functions only — triggers already point to these names.
create or replace function public.on_momento_proposal_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  select handle into v_name from public.profiles where id = new.candidate_id;
  perform public.enqueue_push(
    new.user_id, 'moment', 'notif.tpl.moment',
    jsonb_build_object('name', coalesce(v_name, '')), new.id::text);
  return new;
end;
$$;
revoke execute on function public.on_momento_proposal_push() from public, anon, authenticated;

create or replace function public.on_message_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_name text;
begin
  select case when c.participant_a = new.sender_id then c.participant_b else c.participant_a end
    into v_recipient
  from public.conversations c
  where c.id = new.conversation_id;
  if v_recipient is not null and new.kind = 'user' then
    select handle into v_name from public.profiles where id = new.sender_id;
    perform public.enqueue_push(
      v_recipient, 'message', 'notif.tpl.message',
      jsonb_build_object('name', coalesce(v_name, ''), 'preview', left(coalesce(new.body, ''), 140)),
      new.conversation_id::text);
  end if;
  return new;
end;
$$;
revoke execute on function public.on_message_push() from public, anon, authenticated;
