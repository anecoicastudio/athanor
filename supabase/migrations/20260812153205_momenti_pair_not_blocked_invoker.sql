-- athanor.pair_not_blocked back to SECURITY INVOKER (review finding on 20260812145446).
--
-- It was created DEFINER by analogy with athanor.not_blocked, which genuinely needs it: that one
-- answers "is the CALLER blocked by this person?" for an `authenticated` caller who has no
-- SELECT policy on the other direction of `public.blocks`, so without DEFINER a blocked member
-- could learn who blocked them. pair_not_blocked answers a different question — "are these two
-- arbitrary people blocked, in either direction?" — and its only callers are inside
-- run_momenti_matcher(), which is itself DEFINER and owned by the same role. The nested DEFINER
-- therefore grants nothing the outer function does not already have, while adding one more
-- function that reads `blocks` with elevated rights.
--
-- Rule 2 / rules/supabase-db.md: DEFINER only when genuinely required, and back to invoker when
-- the rationale stops holding. It never held here. EXECUTE stays revoked from
-- public/anon/authenticated either way, so nothing about who may call it changes.
--
-- Separate migration because 20260812145446 and 20260812151459 are both applied (rule 7).
alter function athanor.pair_not_blocked(uuid, uuid) security invoker;

comment on function athanor.pair_not_blocked(uuid, uuid) is
  'Mutual-block check for a pair with NEITHER side being the caller — the matcher runs as cron '
  'with no auth.uid(), so athanor.not_blocked cannot answer for it. SECURITY INVOKER: its only '
  'callers already run as the table owner, and unlike not_blocked it has no blocked-member '
  'oracle to protect against, because it is never reachable by authenticated (execute revoked).';
