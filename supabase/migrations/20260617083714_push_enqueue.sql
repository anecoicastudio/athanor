-- M5 push enqueue: fire push-dispatch on a new Momento proposal and a new chat message.
-- Guarded — a no-op until app.settings.push_dispatch_url / _key are set (deferred live config),
-- so inserts on momento_proposals / messages never fail when push is unconfigured.
create extension if not exists pg_net;

create or replace function public.enqueue_push(
  p_recipient uuid,
  p_type text,
  p_template_key text,
  p_params jsonb,
  p_entity_ref text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := current_setting('app.settings.push_dispatch_url', true);
  v_key text := current_setting('app.settings.push_dispatch_key', true);
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- push not configured (pre-deploy) → no-op, never block the insert
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object(
      'recipient_id', p_recipient,
      'type', p_type,
      'template_key', p_template_key,
      'params', coalesce(p_params, '{}'::jsonb),
      'entity_ref', p_entity_ref
    )
  );
end;
$$;
revoke execute on function public.enqueue_push(uuid, text, text, jsonb, text) from public, anon, authenticated;

-- new Momento proposal → «Hai un Momento» to the recipient (user_id is the recipient)
create or replace function public.on_momento_proposal_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.enqueue_push(new.user_id, 'moment', 'notif.tpl.moment', '{}'::jsonb, new.id::text);
  return new;
end;
$$;
revoke execute on function public.on_momento_proposal_push() from public, anon, authenticated;

create trigger momento_proposals_push
  after insert on public.momento_proposals
  for each row execute function public.on_momento_proposal_push();

-- new message → push the OTHER participant (sender never pushes themselves)
create or replace function public.on_message_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  select case when c.participant_a = new.sender_id then c.participant_b else c.participant_a end
    into v_recipient
  from public.conversations c
  where c.id = new.conversation_id;
  if v_recipient is not null and new.kind = 'user' then
    perform public.enqueue_push(v_recipient, 'message', 'notif.tpl.message', '{}'::jsonb, new.conversation_id::text);
  end if;
  return new;
end;
$$;
revoke execute on function public.on_message_push() from public, anon, authenticated;

create trigger messages_push
  after insert on public.messages
  for each row execute function public.on_message_push();
