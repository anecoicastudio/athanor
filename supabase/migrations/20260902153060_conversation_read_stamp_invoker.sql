-- athanor.stamp_conversation_read goes back to INVOKER (#637 item 4).
--
-- 20260902153059 (this PR, already applied to staging — hence a new file rather than an edit)
-- shipped it SECURITY DEFINER out of habit, copying the shape of every other trigger function in
-- this schema. Those need it: they reach across tables the caller cannot read, or call the guarded
-- enqueue. This one assigns `new.last_read_at := now()` and touches nothing at all — no table, no
-- sequence, no function outside pg_catalog. rules/supabase-db.md's line is "SECURITY DEFINER only
-- when genuinely required … a DEFINER function whose rationale no longer holds should go back to
-- invoker", and here the rationale never held.
--
-- It is not a live vulnerability: `set search_path = ''` was locked and execute was revoked from
-- public/anon/authenticated, so 0080's DEFINER sweep passed both ways. It is an unnecessary
-- privilege on a function reachable from every chat open, which is exactly the sort of thing that
-- stops being harmless the day someone adds a second statement to the body.
--
-- The revoke is re-asserted: `create or replace` preserves the existing ACL, but a bare
-- create-or-replace elsewhere in this repo has silently restored PUBLIC execute before, and
-- 0121 pins anon's and PUBLIC's executable surface by name.
create or replace function athanor.stamp_conversation_read()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.last_read_at := now();
  return new;
end; $$;
revoke execute on function athanor.stamp_conversation_read() from public, anon, authenticated;
