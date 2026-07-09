-- sec(supabase): move pg_net out of the public schema (advisor lint 0014_extension_in_public).
--
-- 20260703154523_p2_2_media_process_enqueue.sql created it with a bare
-- `create extension if not exists pg_net` — default schema = public.
-- pg_net is relocatable=false (pg_net.control), so `alter extension ... set schema`
-- is unsupported; drop/recreate is the documented move.
--
-- Safe to drop: pg_net's own objects live in its dedicated `net` schema and are
-- recreated identically on create; its request/response queue tables are UNLOGGED
-- transients (nothing durable). The enqueue functions (push_enqueue,
-- enqueue_media_process) call net.http_post from plpgsql — late-bound, no pg_depend
-- edge — so triggers and app.settings.* GUC wiring are untouched.

drop extension if exists pg_net;
create extension pg_net with schema extensions;
