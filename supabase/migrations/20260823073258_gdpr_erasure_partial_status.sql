-- #515 — an erasure request that was processed but stopped short is recorded as 'partial',
-- not as 'failed'.
--
-- The erasure job (11) is legal-gated: it revokes the member's sessions and runs the fund
-- footprint erasure (#240 — contributions tombstoned to the no-PII sentinel, candidacies and
-- votes deleted, aggregates recomputed, candidacy videos removed from Storage), and then
-- stops, because deleting auth.users is gated on counsel's retention answer (#184). It has
-- always written 'failed' at that point, with a comment explaining that 'done' would report a
-- partial erasure as complete.
--
-- 'failed' is the wrong record for the opposite reason: nothing failed. Real work ran and is
-- irreversible, and a status that says otherwise misleads whoever reads the table next —
-- including a retry that assumes nothing happened. The four-value set had no way to say
-- «processed as far as the law currently allows», so this adds one.
--
-- The check constraint is restated in full (append-only migrations; the same pattern as
-- 20260822115759). No data migration: existing 'failed' rows are NOT rewritten, because this
-- migration cannot tell an actually-failed request from a legal-gated one — the job wrote the
-- same string for both. They stay as they are and #107 reconciles them when the gate clears.
--
-- Client writes are unaffected: gdpr_erasure_requests_insert_own already pins
-- `status = 'requested'` on INSERT and there is no client UPDATE policy or grant, so 'partial'
-- is reachable only by the service-role job. Widening the CHECK does not widen that surface.

alter table public.gdpr_erasure_requests drop constraint gdpr_erasure_requests_status_check;
alter table public.gdpr_erasure_requests add constraint gdpr_erasure_requests_status_check
  check (status in ('requested','processing','done','partial','failed'));

comment on column public.gdpr_erasure_requests.status is
  'requested → processing → done | partial | failed. ''partial'' = the job ran and its irreversible steps completed, but the account itself is not erased yet (legal gate, #184/#107) — distinct from ''failed'', which means the run did not do what it set out to do. Written ONLY by the service-role erasure-job; clients may insert ''requested'' and nothing else.';
