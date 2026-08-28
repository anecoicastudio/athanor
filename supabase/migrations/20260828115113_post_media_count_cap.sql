-- post_media: bound `position` ABOVE, which is what caps a post's media set at 10 rows (#591).
--
-- `MEDIA_LIMITS.MAX_POST_MEDIA` (packages/core/src/media/limits.ts) has said 10 since M3 and is
-- read at exactly three sites, all of them in apps/native's post-compose modal: the picker's
-- `onPickMedia`, the attach button's `disabled`, and that button's label colour. So the cap was a
-- property of one screen. `publish_post` (20260828083140) deliberately did not hoist it, and
-- `post_media` carried no cardinality constraint of any kind — an `authenticated` member calling
-- `/rest/v1/rpc/publish_post` or `POST /rest/v1/post_media` directly could attach an unbounded
-- media set to their own post. RLS cannot help there: the author genuinely is the author. Only a
-- constraint refuses it, which is the same argument #56 made for the duration bound
-- (20260822181350).
--
-- WHY A POSITION BOUND IS A COUNT CAP, and why that is the whole implementation:
-- `20260614203046_post_media.sql` already created `post_media_post_position`, UNIQUE on
-- (post_id, position). Confine `position` to [0, 10) and the pigeonhole does the rest — ten
-- distinct values, one row each, at most ten rows per post. No row ever has to count its
-- siblings.
--
-- That matters, because the two shapes the issue sketched both cost more and enforce less:
--   * a CHECK that counts rows cannot be written at all — a CHECK sees only its own row;
--   * a trigger that counts rows RACES. Two concurrent single-row inserts each see nine
--     committed siblings and both proceed, and the direct-POST path this exists to close is
--     precisely the one an attacker fires concurrently. Serialising it needs an explicit lock on
--     the parent post per insert, and the trigger function would then owe a `revoke execute …
--     from public, anon, authenticated` (0121_grant_catalog_sweep asserts that of every trigger
--     function) — a new privileged object, a per-insert lock, and a weaker guarantee.
-- A unique index cannot race: uniqueness is enforced by the index itself, and the second of two
-- concurrent inserts blocks on the first's index entry and then fails. Both are also
-- role-independent — the RPC path, the direct-POST path, `service_role`, a future bulk restore
-- and a wider staging seed all meet the same bound, where an RLS-shaped or function-shaped guard
-- would only bind the caller it was written for.
--
-- Nothing the app can do produces a row this rejects: post-compose sends `position: index` over a
-- list it caps at 10 (post-compose.tsx:142), so a legitimate set is always 0..n-1 with n ≤ 10.
-- What it does newly refuse is a sparse or arbitrary position (a single row at position 42) —
-- unreachable through the composer, and the shape a hand-rolled client would use to smuggle an
-- eleventh attachment past a naive count.
--
-- 20260614203046 declared the bound inline as an anonymous CHECK, auto-named
-- `post_media_position_check`, and stays untouched (migrations are append-only). Postgres cannot
-- edit a CHECK in place, so it is dropped and re-added under that same name and a from-zero
-- replay therefore ends in the catalog state the hosted projects reach.
--
-- Safe to apply, verified before this migration was written rather than after: staging holds 5
-- post_media rows, max `position` 0, at most 1 row per post; production holds none. The
-- constraint is added VALIDATED — at these row counts the scan is free, and a `not valid` here
-- would leave the very claim this migration makes unenforced for existing rows.
--
-- The 10 is now a migration-gated product constant: it changes with a migration, not with a
-- client release. packages/schemas/src/post-media-count.mirror.test.ts pins it to
-- MEDIA_LIMITS.MAX_POST_MEDIA so the two cannot drift apart silently.

alter table public.post_media
  drop constraint if exists post_media_position_check;

alter table public.post_media
  add constraint post_media_position_check
  check ("position" >= 0 and "position" < 10);

comment on constraint post_media_position_check on public.post_media is
  'A post carries at most 10 media rows (#591) — mirrors MEDIA_LIMITS.MAX_POST_MEDIA in packages/core, pinned by packages/schemas/src/post-media-count.mirror.test.ts. The CAP is this bound together with the post_media_post_position unique index on (post_id, position): ten admissible positions, one row each. Enforcing it here rather than in publish_post binds the direct POST /rest/v1/post_media path and every service-role writer too.';
