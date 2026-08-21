-- #180 — the updated_at / touch-trigger convention: one real fix, fourteen written exemptions.
--
-- rules/supabase-db.md wants created_at + updated_at + a touch trigger on every new table.
-- Fifteen tables have no updated_at at all (the issue said fourteen; a recount against the
-- catalog says fifteen). Exactly one of them mutates in a way nothing records:
-- public.notifications, whose read_at is client-updatable (20260620025158_m9_notifications.sql:37)
-- with no stamp of when it flipped. That is the gap this migration closes — and it is the one
-- that will be missed, because #126/#127 are open questions about notifications that never
-- arrive, and "when was this marked read" is the first thing that diagnosis asks.
--
-- The other fourteen are deliberate, and stay as they are. What they lacked was a written
-- reason. Migrations are append-only, so the reason cannot be added to the migrations that
-- created them the way athanor.waitlist_throttle (20260809160525:53-60) and
-- public.event_attendance (20260616014758:1-6) wrote theirs inline. The catalog is the durable
-- home instead: each table carries its reason in its own comment, tagged
-- `CONVENTION EXEMPTION (#180)` so a single query returns the whole set.
-- supabase/tests/0128_updated_at_convention.test.sql then turns the one-time cleanup into an
-- invariant — a future table with no updated_at fails CI until it says why.
--
-- Deliberately NOT a MIGRATIONS-ERRATA.md entry: nothing in those migrations is wrong, so there
-- is no correction to record. Errata is for prose that overstates its SQL; this is prose that
-- was never written in the first place.

-- ── 1. public.notifications — the one genuine gap ────────────────────────────────────────────

alter table public.notifications
  add column updated_at timestamptz not null default now();

-- Existing rows were never updated; the default would claim they just were. created_at is the
-- honest value for a row that has only ever been inserted. This runs BEFORE the trigger exists,
-- so the backfill does not fight it.
update public.notifications set updated_at = created_at;

comment on column public.notifications.updated_at is
  'When the row last changed — in practice when read_at was stamped. Written ONLY by the touch trigger: authenticated holds update(read_at) and nothing else (20260620025158 + 20260620025819), and a column added later inherits no grant, so a client cannot forge this value.';

create trigger notifications_touch_updated_at
  before update on public.notifications
  for each row execute function public.touch_updated_at();

-- No grant follows, and that is the point: authenticated's UPDATE on this table is column-scoped
-- to read_at, and a column added afterwards is not covered by that grant. The trigger is the only
-- writer. Note for whoever tidies this later: notifications is one of the seven column-level-ACL
-- tables, so `revoke all on table` here would take the read_at grant down with it — name verbs.

-- ── 2. The fourteen deliberate exemptions, stated at their tables ────────────────────────────
--
-- Each comment below reproduces the table's existing description verbatim and appends the
-- exemption. `comment on table` replaces rather than appends, so the original text has to be
-- carried through by hand — it is not being rewritten.

-- Append-only: inserted once, only ever deleted.

comment on table public.email_waitlist is
  'Pre-launch email waitlist captured from the web landing. Anon insert-only; readable only via service_role. Not user content (no owner / RLS-ownership predicate).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — append-only. A row is inserted once and thereafter only deleted (retention purge). There is no UPDATE policy and no server UPDATE path, so an updated_at could never be anything but a copy of created_at.';

comment on table public.aura_events is
  'Append-only Aura ledger — one row per scoring action. Service-role write only; never client-writable (PRD §4.9, rule #1).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — append-only by design, and the design is rule #1. A ledger row that could be updated is a reputation score that could be rewritten after the fact; the absence of an update path IS the guarantee. Corrections are compensating rows, never edits.';

comment on table public.audit_log is
  'Append-only audit. Moderation rows written only by resolve_report (DEFINER); fund rows (declare_winner) written only by declare_winner() as service_role. Admin-read only (athanor.is_admin). Zero Aura (rule #1).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — append-only, for the same reason as aura_events. An audit trail whose rows can change is not an audit trail.';

comment on table public.connections is
  'Accepted connection edges (ordered pair, profile_a < profile_b). Written when a connection_request is accepted; the mutable side of that flow is connection_requests, not this table.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — append-only. The row records that an edge came into existence at created_at; it is never rewritten. There is no UPDATE policy and no server UPDATE path. (This table previously carried no comment at all.)';

-- Insert/delete only: the row itself is the state, so a change is a different row.

comment on table public.post_reactions is
  'A single ✦ — light a star. One per (post, person). ANTI-VANITY: a person reads only their OWN row; the aggregate is author-only via post_reaction_count() (CLAUDE.md #3, PRD §4.5). Emits the M6 domain event; never writes aura.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — insert/delete only. Un-starring deletes the row rather than updating it, so the row has exactly one state and created_at already dates it.';

comment on table public.story_reactions is
  'A ✦ — celebrate a growth step. One per (segment, person). ANTI-VANITY: person reads only their own; the celebration count is owner-only via story_reaction_count() (CLAUDE.md #3). Emits a domain event for the M6 score-engine (+4); never writes aura.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — insert/delete only, same shape as post_reactions.';

comment on table public.blocks is
  'Blocker CRUD own (immutable: create/delete only). Mutual-invisibility enforced in the read policies of profiles/posts/post_comments/story_segments/momento_proposals/conversations/messages via athanor.not_blocked. pgTAP asserts both directions. Zero Aura (rule #1).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — insert/delete only, as the description already states. Unblocking deletes the row.';

comment on table public.athanor_days_interest is
  'Athanor Days "Avvisami" registrations (PRD §4.6, frontend 04 §3.1.1). Owner insert; idempotent per (user_id, edition).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — insert-only. The idempotent upsert is ON CONFLICT DO NOTHING (packages/api/src/events.ts registerAthanorDaysInterest), so registering twice never rewrites the row.';

comment on table public.candidacy_votes is
  'One vote per member per edition. weight is always 1.000 — equal vote (PRD §4.11): Aura gates who may vote, never how much a vote counts. Server-written by trigger (client never sends it). Own-row read only; aggregates via candidacy_tally(). Zero Aura (rule #1).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — a ballot is immutable. There is no UPDATE policy and no UPDATE grant; the only UPDATE this table has ever seen was the one-time weight backfill in 20260811094524_equal_vote_backfill.sql. Changing a vote is delete-then-insert, which the DELETE policy allows and which dates itself.';

comment on table public.messages is
  '1:1 chat messages. Clients insert only kind=user (sender=self). system/prompt ice-breakers are server-only.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — a message is never edited. There is no UPDATE policy and no server UPDATE path; a correction is a new message. Caveat for whoever lands the soft-delete: the deleted_at column exists and is read-filtered (packages/api/src/messages.ts), but NOTHING writes it today. The first writer of deleted_at is an UPDATE path, and this exemption stops holding the moment it lands — add the touch trigger in the same migration.';

-- Mutable, but the column that records the mutation already exists and says more.

comment on table public.aura_scores is
  'Computed Aura snapshot (0–1000 + six breakdown buckets). World-readable; service-role write only (rule #1).

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — the row IS rewritten, on every score-engine run, but computed_at already records exactly that and names it honestly. This table has no created_at either: a snapshot has no birthday worth keeping, only a freshness. A generic updated_at beside computed_at would be a second name for one fact.';

comment on table public.stripe_webhook_events is
  'Idempotency ledger — every webhook upserts on event_id before processing (backend 00 §7). Service-role only.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — rows DO mutate (the handler stamps claimed_at to take the processing lease, clears it on release, then stamps processed_at on completion), but each of those columns records its own mutation with its meaning attached. A generic updated_at would only say "one of them moved". Rule #6 also applies: money state is a cache of Stripe, and the authoritative timeline is Stripe''s.';

-- Already documented inline at their creating migrations; tagged here so one query finds the
-- whole exempt set rather than twelve of fourteen.

comment on table public.event_attendance is
  'Check-in records. Organizer-only write (RLS joins events.organizer_id). Idempotent on ticket_id. Immutable (no update/delete). Score effect (+15/+30) is M6 (07), never written here.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger — immutable system record, stated at length in 20260616014758_event_attendance.sql:1-6. Repeated here so the exempt set is queryable from the catalog.';

comment on table athanor.waitlist_throttle is
  'Fixed-window signup counters for the public waitlist (issue #23). Never holds a raw IP: key_hash is sha256(window_start || address). Self-pruning — the trigger deletes expired windows on every insert, so this needs no cron and keeps nothing beyond two windows.

CONVENTION EXEMPTION (#180): no updated_at, no touch trigger, and no surrogate PK or created_at either — an internal counter overwritten in place and pruned within two windows, argued in full at 20260809160525_waitlist_throttle_trigger.sql:53-60. Repeated here so the exempt set is queryable from the catalog. Not precedent for a domain table.';
