-- #733, fifth and last — restate the revoke that 20260910140902 relied on surviving.
--
-- CREATE OR REPLACE FUNCTION leaves ownership and privileges unchanged, so the revoke from
-- 20260910130552 did survive 140902's replacement of gdpr_ban_on_erasure_request(); 0121
-- (every trigger function, dynamically) and 0151 §6 both assert it. The convention in this
-- schema — stated in 20260823130236 and followed by every other create-or-replace of a trigger
-- function — is to say it again anyway, so the reader never has to know which way it goes.
-- 140902 is applied and append-only; this file is the one line it should have ended with.

revoke execute on function public.gdpr_ban_on_erasure_request() from public, anon, authenticated;
