-- Backfills the hosted-only migration `20260618131931 m7_voting_weight_trigger_fix` into the
-- repo. Hosted (kwzeiqvrnnaagccyoose) has this migration applied with NO corresponding local
-- file — a `supabase db reset`/reprovision from this repo would silently lose it (repo ≠ hosted).
--
-- Body reconstructed VERBATIM (not just re-derived from live objects) by reading
-- `supabase_migrations.schema_migrations.statements` for version 20260618131931 on hosted via
-- the Supabase MCP `execute_sql` tool — this is the exact SQL Postgres recorded as applied, so
-- there is no ambiguity/guesswork in the DDL below.
--
-- Context: the original hosted `m7_voting` (20260618131421 hosted / 20260618131250 local,
-- `20260618131250_m7_voting.sql`) briefly had a buggy insert policy —
-- `with check ((select auth.uid()) = voter_id and weight = 0)` — and a trigger that
-- unconditionally overwrote `weight` with the Aura snapshot. Because a PG RLS `WITH CHECK` runs
-- AFTER a `BEFORE INSERT` trigger, that check only ever saw the trigger's rewritten value
-- (e.g. 0.700), never the client's original 0 → every Aura-holding voter's insert was rejected
-- (42501). This corrective migration moved the client-tamper guard into the trigger itself
-- (which still sees the ORIGINAL `NEW.weight` before the rewrite) and dropped the `weight = 0`
-- predicate from the insert policy.
--
-- NOTE: the local `20260618131250_m7_voting.sql` file in this repo was authored (single commit,
-- pre-push) already containing the POST-fix logic — i.e. replaying today's local migrations from
-- scratch already reproduces hosted's current end state. This backfill migration exists purely
-- for migration-HISTORY fidelity (repo migration count/lineage == hosted), not to change current
-- behavior. It is idempotent in this repo's replay order: `create or replace function` is a
-- byte-for-byte no-op (identical body already installed by `m7_voting.sql`), and the
-- drop-then-recreate of the insert policy recreates an identical policy (safe because
-- `m7_voting.sql` already created it in the non-buggy form — the `drop policy` below only ever
-- runs after that `create policy` has succeeded).

drop policy "candidacy_votes_insert_own" on public.candidacy_votes;
create policy "candidacy_votes_insert_own"
  on public.candidacy_votes for insert
  to authenticated
  with check ((select auth.uid()) = voter_id);

create or replace function public.set_candidacy_vote_weight()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.weight is distinct from 0 then
    raise exception 'weight is server-written' using errcode = '42501';
  end if;
  new.weight := coalesce(
    (select s.score::numeric / 1000 from public.aura_scores s where s.profile_id = new.voter_id),
    0
  );
  return new;
end;
$$;
revoke execute on function public.set_candidacy_vote_weight() from public, anon, authenticated;
