-- conversation_reads.last_read_at is stamped by the SERVER, not by the caller (#637 item 4).
--
-- 20260902153057 (this PR, already applied to staging — hence a new file rather than an edit)
-- left the column client-writable with a `default now()`. A default only fires on INSERT, so the
-- upsert that re-marks an existing cursor had to send a timestamp, and the timestamp it can send
-- is the DEVICE's clock. Both skew directions are a visible bug and neither is exotic:
--   * clock behind → last_read_at lands before the message that is already on screen, and the
--     thread stays lit after the member has read it, forever;
--   * clock ahead  → the cursor sits in the future and swallows the next real reply.
-- Unread is the one thing this table exists to compute, so a value the server cannot vouch for
-- is the wrong shape for it.
--
-- A BEFORE INSERT OR UPDATE trigger overwrites whatever arrived. `last_read_at` therefore means
-- "when the server was told", which is the only reading that is true for both participants at
-- once. It also makes the column unforgeable — a member cannot back-date their own cursor to keep
-- a thread lit, or forward-date it to mute one — though that is a side effect, not the point:
-- nothing about this table is a security boundary, it is their own read state either way.
--
-- The alternative was a SECURITY DEFINER RPC stamping now(). A trigger is less surface: no new
-- executable grant to pin in 0121, no PostgREST exposure question, and the plain
-- upsert-under-RLS path keeps working unchanged.
create or replace function athanor.stamp_conversation_read()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.last_read_at := now();
  return new;
end; $$;
revoke execute on function athanor.stamp_conversation_read() from public, anon, authenticated;

create trigger conversation_reads_stamp_last_read_at
  before insert or update on public.conversation_reads
  for each row execute function athanor.stamp_conversation_read();

comment on column public.conversation_reads.last_read_at is
  'When the SERVER was told this member read the thread. Overwritten with now() on every insert and update by conversation_reads_stamp_last_read_at — a value the caller sends is ignored.';
