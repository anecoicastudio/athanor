-- #127 follow-up — the dedupe index must be INFERRABLE by ON CONFLICT, so it cannot be partial.
--
-- 20260823121933 created notifications_recipient_dedupe as a PARTIAL unique index
-- (`where dedupe_key is not null`). That index is correct as a constraint and wrong as a
-- conflict target: PostgreSQL only infers a partial index from an ON CONFLICT clause when the
-- statement repeats the index predicate, and PostgREST's `on_conflict=` parameter carries
-- column names only — there is nowhere to put a WHERE. The bulk insert therefore failed with
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- and the whole broadcast 500'd. Caught by firing a real broadcast against staging; the
-- function's own unit tests could not catch it, because they assert against a fake PostgREST
-- that accepts any onConflict string. Fail-closed, at least: zero rows were written, so nothing
-- was half-delivered.
--
-- Dropping the predicate loses nothing the predicate was protecting. The property that matters
-- is «two unkeyed rows are two real events, never deduped» — «Hai un Momento» twice is two
-- Momenti — and that comes from NULL semantics, not from the WHERE: in a btree unique index
-- NULLs are DISTINCT, so any number of rows with a NULL dedupe_key coexist. (The behaviour
-- would only change under NULLS NOT DISTINCT, which this index does not use and must not.)
-- 0131 asserts both halves.
--
-- The cost is honest and it is the reason the predicate was there: the index now covers every
-- row of what will be one of the largest tables, rather than only the keyed minority. That is
-- accepted here because the alternative is a broadcast path that cannot dedupe at all, and the
-- retry safety #521 asks for is worth more than the pages. If notifications ever grows enough
-- for this to matter, the fix is to move the insert into a service-role RPC that can spell
-- `on conflict (recipient_id, dedupe_key) where dedupe_key is not null` in full — not to
-- re-narrow the index and leave ON CONFLICT broken again.

drop index public.notifications_recipient_dedupe;

create unique index notifications_recipient_dedupe
  on public.notifications (recipient_id, dedupe_key);

comment on index public.notifications_recipient_dedupe is
  'Idempotency for broadcast notifications (#127/#521). NOT partial, deliberately: ON CONFLICT '
  'cannot infer a partial index through PostgREST. Unkeyed rows stay undeduped because NULLs '
  'are distinct in a btree unique index — do not add NULLS NOT DISTINCT.';
