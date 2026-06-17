begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select has_function('public', 'enqueue_push',
  array['uuid', 'text', 'text', 'jsonb', 'text'], 'enqueue_push(uuid,text,text,jsonb,text) exists');
select trigger_is('public', 'momento_proposals', 'momento_proposals_push',
  'public', 'on_momento_proposal_push', 'momento_proposals INSERT fires the push trigger');
select trigger_is('public', 'messages', 'messages_push',
  'public', 'on_message_push', 'messages INSERT fires the push trigger');

-- (no-op safety: with app.settings.push_dispatch_url unset, enqueue_push returns without error;
--  the existing 0027/0029 RLS tests already insert into these tables and still pass under this trigger.)

select * from finish();
rollback;
