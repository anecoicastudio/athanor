-- #107: the status column's own description said 'partial' means «stopped at the legal gate».
-- There is no gate any more, so the comment describes a state the job cannot produce.
--
-- The comment is a LIVE database object, unlike the migration header that wrote it
-- (20260823073258, frozen — its prose is recorded in supabase/MIGRATIONS-ERRATA.md), so it can
-- and should be corrected here rather than left to rot. `comment on column` REPLACES the whole
-- text, so the wording below is the previous one rebuilt from `col_description`, not a fragment
-- appended to it.
--
-- What changed: 'partial' is now historical. The job writes 'done' or 'failed' and nothing else;
-- the rows still carrying 'partial' were written before #107 and are re-driven by hand once per
-- project (docs/RELEASE-RUNBOOK.md §7.5). The value stays in the CHECK — those rows have to
-- remain writable and readable — and stays unreachable by any client, which 0058 asserts.

comment on column public.gdpr_erasure_requests.status is
  'requested → processing → done | failed. ''done'' = the whole cascade ran, up to and including the auth.users delete (#107). ''failed'' = a step did not do what it set out to do, which includes the job declining to delete the account because the retained payment rows were not safely pseudonymised first. ''partial'' is HISTORICAL: it meant the job had run its irreversible steps and stopped at the legal gate #184 closed on 2026-09-07, and the job no longer writes it — the rows that carry it predate #107 and are re-driven by hand (RELEASE-RUNBOOK §7.5). Written ONLY by the service-role erasure-job; clients may insert ''requested'' and nothing else.';
