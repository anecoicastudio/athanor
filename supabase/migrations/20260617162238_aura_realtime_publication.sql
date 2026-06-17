-- M6 celebration-realtime follow-up: publish the Aura tables to supabase_realtime so the
-- client postgres_changes listeners (subscribeAura onScore/onEvent/onStar) deliver. RLS still
-- governs per-subscriber delivery (aura_events owner-only, stars earned-only for others). The
-- engine remains the SOLE writer (rule #1) — publication does not grant any client write.
alter publication supabase_realtime add table public.aura_scores;
alter publication supabase_realtime add table public.aura_events;
alter publication supabase_realtime add table public.stars;
