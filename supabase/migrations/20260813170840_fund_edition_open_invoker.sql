-- fund_edition_open() reverts to SECURITY INVOKER (#145 DEFINER re-audit).
--
-- 20260617225450:118 created it DEFINER, but definer rights never did anything here:
-- fund_editions was already world-readable for every client role — `grant select … to
-- anon, authenticated` plus fund_editions_select_public `using (true)`, both from
-- 20260617212319, which predates the function — so an invoker read returns the identical
-- rows. supabase-db.md allows DEFINER only when genuinely required; this follows the
-- 20260811094524 precedent (set_candidacy_vote_weight): revert, so that if the body ever
-- grows a read of a protected table it is RLS-constrained by default rather than silently
-- privileged. Both callers are storage.objects policies evaluated as `authenticated`
-- (20260617225450:169 read gate, 20260617234036:20 insert gate), a role that holds the
-- table grant and passes the using(true) policy — behaviour unchanged. search_path stays
-- locked; existing grants survive CREATE OR REPLACE (execute revoked from public/anon,
-- granted to authenticated — 0043 asserts the anon half). pgTAP 0043 pins prosecdef =
-- false from this migration on.
create or replace function public.fund_edition_open()
returns boolean
language sql
security invoker
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.fund_editions
    where candidacy_window_open = true and phase <> 'closed'
  );
$$;

comment on function public.fund_edition_open() is
  'True while any fund edition has its candidacy window open. Gates candidacy-videos bucket reads (10 §4.2). SECURITY INVOKER since the #145 re-audit: fund_editions is world-readable (using (true)), so definer rights added nothing.';
