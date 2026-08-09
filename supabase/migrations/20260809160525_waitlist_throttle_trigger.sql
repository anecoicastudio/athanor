-- Throttle the one surface guaranteed to be public before anything else (issue #23).
--
-- `POST /api/waitlist` is unauthenticated and unthrottled. It has a honeypot (`company`), which
-- stops naive bots and nothing else, and the duplicate check is no defence at all because an
-- attacker never repeats an address. This is the pre-launch marketing page — the first thing
-- anyone finds — and every accepted request writes a row.
--
-- ── Why a TRIGGER and not an anon-callable RPC ──────────────────────────────────────────────
--
-- The obvious shape is a SECURITY DEFINER function the route calls before inserting. It was
-- built that way first and `supabase/tests/0080_rls_catalog_sweep.test.sql` rejected it:
--
--   'rules/supabase.md:11: no SECURITY DEFINER function is executable by anon (or PUBLIC)'
--
-- That assertion is absolute and its own comment says it exists to catch "an explicit grant" as
-- well as a forgotten revoke — so it was doing its job. DEFINER is genuinely required here
-- (anon must be able to CONSUME a slot without being able to read, reset or forge a counter),
-- which leaves one way to have both: attach it to the write it is protecting.
--
-- A trigger function needs no EXECUTE grant to fire — PostgreSQL checks that privilege at
-- CREATE TRIGGER, and the executor calls it directly with no ACL check at fire time. So this is
-- DEFINER, unreachable by anon, and the sweep keeps zero exceptions. Every aura award trigger in
-- this repo is built the same way. It also removes a class of mistake: the throttle cannot be
-- forgotten at a call site, because there is no call site. Any path that inserts into
-- email_waitlist is throttled, including ones that do not exist yet.
--
-- ── The key, and why the ROUTE has to supply it ─────────────────────────────────────────────
--
-- `request.headers` is what PostgREST received — and PostgREST is not talking to the browser.
-- The insert happens inside a Vercel function, so left alone this would key on that function's
-- egress IP: a handful of regional addresses shared by every visitor, i.e. a site-wide budget
-- wearing a per-client label, with real users throttling each other off. `apps/web`'s route
-- therefore reads the visitor's address from ITS request and forwards it on the Supabase client
-- (`utils/supabase/server.ts`, `createClient(forwardedFor)`); the counting still lives here.
--
-- `x-forwarded-for` is a comma-separated chain and the FIRST entry is the client — each proxy
-- appends, so taking the last would key on whatever hop is nearest and undo the whole point.
--
-- It is client-supplied and forgeable either way. This is a COST control, not an authorization
-- boundary: rotating the header defeats the per-client budget, and a WAF rule in front is still
-- worth having. What it buys is that the trivial attack — one script, one fresh address per
-- request — stops being free. With no header at all every caller shares the `unknown` key, so a
-- proxy stripping it makes the budget stricter rather than absent: the right way to fail.
--
-- ── Privacy ─────────────────────────────────────────────────────────────────────────────────
--
-- The raw address never reaches the table. It is hashed with the window start as a per-window
-- salt, which costs nothing (the value is already constant within a window, so lookups still
-- match) and means a hash cannot be correlated across windows. Rows are pruned by the function
-- itself on every insert rather than by a cron — this table must not inherit the retention gap
-- that `athanor.purge_email_waitlist()` has, where the function exists and the schedule does not.

-- ── Table-convention exemption, stated because this is the FIRST table in `athanor` ─────────
--
-- rules/supabase.md wants a UUID PK plus created_at/updated_at + touch trigger on every new
-- table. This one deliberately has neither: it is an internal counter, not user content. The
-- composite (key_hash, window_start) PK IS the identity — a surrogate uuid would let two rows
-- claim one window and silently double a budget — `window_start` already is the created_at, and
-- `updated_at`/`deleted_at` are meaningless for a row that is overwritten in place and pruned
-- within two windows. Do not read this as precedent for a domain table in this schema.
create table if not exists athanor.waitlist_throttle (
  key_hash     text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key_hash, window_start)
);

-- The prune filters on window_start alone, which the PK (key_hash first) cannot serve. Cheap
-- while the table is small, and it stops being small the moment someone rotates a forged
-- x-forwarded-for: a full scan per insert would then be an amplification vector.
create index if not exists waitlist_throttle_window
  on athanor.waitlist_throttle (window_start);

comment on table athanor.waitlist_throttle is
  'Fixed-window signup counters for the public waitlist (issue #23). Never holds a raw IP: '
  'key_hash is sha256(window_start || address). Self-pruning — the trigger deletes expired '
  'windows on every insert, so this needs no cron and keeps nothing beyond two windows.';

-- No policies and no grants. The table is in `athanor`, which is not in config.toml's exposed
-- `schemas`, so PostgREST cannot see it; RLS with zero policies is deny-all for anyone who
-- somehow reached it anyway. Only the trigger, running as owner, touches it.
alter table athanor.waitlist_throttle enable row level security;
revoke all on table athanor.waitlist_throttle from public, anon, authenticated;
grant all on table athanor.waitlist_throttle to service_role;

-- Five signups per ten minutes from one address. Named constants rather than literals in the
-- body so the numbers are legible and the pgTAP case can state the same ones.
create or replace function athanor.waitlist_throttle_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c_limit  constant integer  := 5;
  c_window constant interval := interval '10 minutes';
  v_start  timestamptz;
  v_hdr    text;
  v_ip     text;
  v_hits   integer;
begin
  v_start := date_bin(c_window, now(), timestamptz 'epoch');

  -- Self-pruning, bounded: drop everything older than two windows on every insert. Two rather
  -- than one because `now()` is transaction start, so two transactions straddling a boundary
  -- compute different windows — a one-window prune would let the later one delete rows the
  -- earlier one is still counting against. This is what keeps the table off a cron it would
  -- not get.
  delete from athanor.waitlist_throttle where window_start < v_start - (2 * c_window);

  -- `true` = missing_ok, so an unset GUC yields NULL rather than raising: it IS unset outside a
  -- PostgREST request (psql, pgTAP, a service-role script) and those must not fail. `nullif` on
  -- top matters just as much — a GUC that was set and reset in a session reads back as the
  -- EMPTY STRING, and ''::json raises 22P02 from inside the trigger, turning a signup into a
  -- 500. Anything unparseable must degrade to `unknown`, never abort the insert.
  v_hdr := nullif(current_setting('request.headers', true), '');
  begin
    v_ip := coalesce(
      nullif(btrim(split_part(coalesce(v_hdr::json ->> 'x-forwarded-for', ''), ',', 1)), ''),
      nullif(btrim(coalesce(v_hdr::json ->> 'x-real-ip', '')), ''),
      'unknown');
  exception when others then
    -- Malformed JSON in a header GUC is not the signer's fault and must not cost them the
    -- signup; it costs them a shared bucket instead, which is the strict direction.
    v_ip := 'unknown';
  end;

  insert into athanor.waitlist_throttle (key_hash, window_start, hits)
  values (encode(sha256(convert_to(v_start::text || '|' || v_ip, 'utf8')), 'hex'), v_start, 1)
  on conflict (key_hash, window_start) do update set hits = athanor.waitlist_throttle.hits + 1
  returning hits into v_hits;

  if v_hits > c_limit then
    -- NOTE the increment above is rolled back with this raise — a refused attempt does not
    -- accumulate, so `hits` parks at c_limit rather than climbing. That is fine: the window is
    -- fixed, so the budget refills on the boundary either way, and the alternative (counting
    -- refusals) would need an autonomous transaction plpgsql does not have.
    --
    -- PT429 rather than a bare `raise exception`: PostgREST maps a PTxxx SQLSTATE onto that
    -- HTTP status, so the refusal arrives as a 429 instead of a 400, and — the part that
    -- matters — the CODE alone identifies it. A plain P0001 is what any future check on this
    -- table would also raise, and answering 429 to an unrelated failure would tell a member to
    -- slow down when nothing was too fast. The message stays a machine token, never shown to a
    -- member (rule #5).
    raise exception using errcode = 'PT429', message = 'waitlist_rate_limited';
  end if;

  return new;
end; $$;

comment on function athanor.waitlist_throttle_check() is
  'BEFORE INSERT throttle on public.email_waitlist (issue #23): 5 signups per 10 minutes per '
  'client address, keyed on a per-window salted hash of the x-forwarded-for the web route '
  'forwards onto the Supabase client. Raises PT429 waitlist_rate_limited over the cap. A '
  'trigger rather than an anon-callable RPC so it can be SECURITY DEFINER without becoming the '
  'first anon-executable DEFINER function in the schema (0080_rls_catalog_sweep).';

-- Rule: revoke from every client role. A trigger fires regardless — EXECUTE is checked when the
-- trigger is created, not when it runs — so this closes the direct-call door without disarming
-- it. (A direct call would fail anyway; the revoke is what keeps the 0080 sweep honest.)
revoke execute on function athanor.waitlist_throttle_check() from public, anon, authenticated;

drop trigger if exists email_waitlist_throttle on public.email_waitlist;
create trigger email_waitlist_throttle
  before insert on public.email_waitlist
  for each row execute function athanor.waitlist_throttle_check();
