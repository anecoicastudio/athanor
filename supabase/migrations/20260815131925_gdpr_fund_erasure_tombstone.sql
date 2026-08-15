-- #240: GDPR erasure reaches the fund tables — tombstone sentinel + the per-table policy.
--
-- Per-table policy (D50; rulings recorded in issue #240's lane):
--   fund_contributions — PSEUDONYMIZE, never delete. Financial-record retention is a stated
--     decision: rows are reassigned to the tombstone sentinel below, so money history survives
--     the (still #107/#184-gated) profiles cascade. The retention window for the tombstoned
--     rows is counsel's answer (#184) and is deliberately NOT encoded here — nothing in this
--     migration deletes a money row, so no window number exists to invent.
--   dream_candidacies — DELETE the row (hard delete, soft-delete state irrelevant to erasure).
--     The candidacy's video + poster blobs live in the candidacy-videos bucket and are not
--     FK-linked to anything; the erasure-job removes them via the Storage API from the
--     manifest gdpr_erase_fund_footprint() returns (deleting storage.objects rows in SQL
--     would orphan the physical files behind the Storage API).
--   candidacy_votes — DELETE: the erased member's own votes here; votes cast by others on the
--     erased member's candidacies go with the candidacy row (candidacy_id ON DELETE CASCADE).
--
-- Consequence, deliberate: erasing a declared winner's candidacy flips
-- fund_editions.winner_candidacy_id to NULL (its FK is ON DELETE SET NULL, 20260617225450 §4).

-- ── 1. The tombstone sentinel (no PII) ─────────────────────────────────────────────────────
-- profiles.id is FK → auth.users ON DELETE CASCADE, so the sentinel profile needs a backing
-- auth.users row. The row is inert by construction: no email, no phone, empty password hash —
-- there is no credential GoTrue could ever accept for it. Token columns are '' rather than
-- NULL for the same GoTrue scan reason the staging seed documents. The profiles row arrives
-- via the handle_new_user trigger (as every profile does): handle/bio stay NULL; the explicit
-- visibility update below opts it out of the #251 anon-public identity shell.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-a000-000000000000',
  'authenticated', 'authenticated',
  null, '',
  '', '', '', '',
  '{}'::jsonb, '{}'::jsonb, now(), now()
)
on conflict (id) do nothing;

update public.profiles
   set visibility = '{"identity": "members"}'::jsonb
 where id = '00000000-0000-4000-a000-000000000000';

-- Single home for the sentinel uuid: the erasure function, the aggregate exclusion and the
-- pgTAP assertions all read it from here, so the literal exists exactly once.
create function public.gdpr_tombstone_profile_id()
returns uuid
language sql
immutable
set search_path = ''
as $$
  select '00000000-0000-4000-a000-000000000000'::uuid
$$;

comment on function public.gdpr_tombstone_profile_id() is
  'Pre-seeded no-PII sentinel profile that GDPR-erased members'' fund_contributions are reassigned to (D50: money rows are pseudonymized, never deleted). Service-role only.';

revoke all on function public.gdpr_tombstone_profile_id() from public, anon, authenticated;
grant execute on function public.gdpr_tombstone_profile_id() to service_role;

-- ── 2. The fund-table erasure reach, atomically ────────────────────────────────────────────
-- One transaction for the row-level reach; the blob removal cannot join it (Storage API, not
-- SQL), so the function RETURNS the removal manifest instead of attempting it. The manifest
-- is derived from storage.objects under the erased member's folder — not recomputed from the
-- path convention — so a retry after a failed blob removal still lists the leftovers even
-- though the candidacy rows are already gone: "no orphaned video object" survives a crash
-- between the two halves.
--
-- SECURITY INVOKER on purpose: the only caller is the erasure-job's service-role client,
-- which already holds every table it touches; definer rights would add nothing (#145 lesson).
create function public.gdpr_erase_fund_footprint(p_profile_id uuid)
returns table (bucket_id text, name text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tombstone uuid := public.gdpr_tombstone_profile_id();
  v_editions uuid[];
  v_edition uuid;
begin
  if p_profile_id = v_tombstone then
    raise exception 'refusing to erase the tombstone sentinel itself';
  end if;

  -- (a) pseudonymize money rows, then refresh the aggregates their editions cache —
  -- reassignment changes contributor_count's population, and the next webhook event
  -- for the edition may be far away.
  with moved as (
    update public.fund_contributions
       set profile_id = v_tombstone
     where profile_id = p_profile_id
    returning edition_id
  )
  select array_agg(distinct m.edition_id) into v_editions from moved m;

  if v_editions is not null then
    foreach v_edition in array v_editions loop
      perform public.recompute_fund_aggregate(v_edition);
    end loop;
  end if;

  -- (b) the erased member's own votes; (c) their candidacies, which cascade every vote
  -- cast on them (candidacy_votes.candidacy_id ON DELETE CASCADE, 20260618131250).
  delete from public.candidacy_votes where voter_id = p_profile_id;
  delete from public.dream_candidacies where profile_id = p_profile_id;

  -- (d) the blob-removal manifest for the erasure-job (whole folder: every candidacy
  -- video + poster the member ever wrote lives under their uid prefix, per the bucket's
  -- owner-write policies).
  return query
    select o.bucket_id, o.name
      from storage.objects o
     where o.bucket_id = 'candidacy-videos'
       and o.name like p_profile_id::text || '/%';
end;
$$;

comment on function public.gdpr_erase_fund_footprint(uuid) is
  'GDPR erasure, fund tables (#240): tombstone-reassign fund_contributions (+ recompute touched aggregates), delete candidacy_votes + dream_candidacies, return the candidacy-videos blob manifest for the erasure-job to remove via the Storage API. Service-role only; idempotent.';

revoke all on function public.gdpr_erase_fund_footprint(uuid) from public, anon, authenticated;
grant execute on function public.gdpr_erase_fund_footprint(uuid) to service_role;

-- ── 3. contributor_count must not count the sentinel ───────────────────────────────────────
-- Same arithmetic as 20260815120318 except the sentinel is excluded from the distinct count.
-- Tombstone reassignment collapses every erased contributor into ONE profile_id, so counting
-- it would show N erased people as one phantom contributor forever. Excluding it makes the
-- metric mean "distinct identifiable contributors": raised_cents keeps every cent (erased
-- members' money is retained by D50), so after an erasure the two aggregates deliberately
-- describe different populations — the divergence #239 removed was accidental NULL-dropping,
-- this one is the pseudonymization doing its job. SECURITY DEFINER + locked search_path and
-- the ACL set preserved from 20260815120318.
create or replace function public.recompute_fund_aggregate(p_edition_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fund_aggregates (edition_id, raised_cents, contributor_count, updated_at)
  select p_edition_id,
         coalesce(sum(amount_cents), 0),
         count(distinct profile_id)
           filter (where profile_id <> public.gdpr_tombstone_profile_id()),
         now()
  from public.fund_contributions
  where edition_id = p_edition_id and status = 'succeeded'
  on conflict (edition_id) do update
    set raised_cents = excluded.raised_cents,
        contributor_count = excluded.contributor_count,
        updated_at = now();
$$;

comment on function public.recompute_fund_aggregate(uuid) is
  'Recompute fund_aggregates from succeeded fund_contributions (rule #6 webhook cache); contributor_count excludes the GDPR tombstone sentinel. Service-role only.';

revoke all on function public.recompute_fund_aggregate(uuid) from public, anon, authenticated;
grant execute on function public.recompute_fund_aggregate(uuid) to service_role;
