-- M6 Aura · strip the hosted default-privilege write grants from the two world-readable
-- engine tables. Without this, hosted ALTER DEFAULT PRIVILEGES auto-grants insert/update/
-- delete to anon/authenticated, so a client write is silently RLS-0-row-filtered instead
-- of 42501 — diverging from CI (vanilla Postgres has no such auto-grant). SELECT stays
-- granted (the score + earned stars are world-readable). Mirrors the events / event_live_stats
-- precedent; aura_events already revokes in its own migration (it is not world-readable).
revoke all on table public.aura_scores from anon, authenticated;
grant select on table public.aura_scores to anon, authenticated;

revoke all on table public.stars from anon, authenticated;
grant select on table public.stars to anon, authenticated;
