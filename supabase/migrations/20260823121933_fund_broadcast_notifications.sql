-- #127 — the fan-out-to-many mechanism, and 'fundMilestone' returns to the closed type set.
--
-- 20260701160235:42-46 SKIPPED fund_aggregates for two stated reasons: notif.tpl.fundMilestone
-- "has no single recipient", and "fund_aggregates has no bounded/opt-in audience column to
-- iterate cheaply". #241 (20260822115759) then removed the type outright, on the same reasoning:
-- what was missing was a mechanism, not a trigger. This migration builds the mechanism, so both
-- reasons stop holding, and re-admits the type in the same change (rule: a type and its producer
-- land together — an unreachable value in a closed set is wiring for nothing).
--
-- ── Shape A: N rows, one audience call (ruled by Marco 2026-08-23) ───────────────────────────
--
-- notification-fan-out gains an AUDIENCE mode: one request carrying type, template_key, params,
-- entity_ref, a dedupe_key and an audience selector, answered by one bulk insert covering every
-- eligible member and a batched push-dispatch loop. The single-recipient path is untouched.
-- Shape B (one broadcast row that clients resolve) was ruled out and is not re-opened here:
-- per-recipient read_at is what makes the notification centre's unread state work at all, and a
-- broadcast row has nowhere to put it.
--
-- ── Idempotency at the ROW, which is new (#521) ──────────────────────────────────────────────
--
-- athanor.enqueue_notification POSTs through pg_net and returns before any response exists, so a
-- 5xx from fan-out loses the notification with no trace (#521, observed live on staging during
-- PR #520: one enqueue of four returned 500 on transient clock skew and that person's reminder
-- was simply gone). A producer-side marker cannot fix this by itself — pg_net gives it nothing
-- to wait for, so the marker is necessarily claimed BEFORE the POST and records a failed
-- dispatch as sent.
--
-- public.notifications had no dedupe key. It gets one here, with a partial unique index on
-- (recipient_id, dedupe_key), so the bulk insert can be `on conflict do nothing` and a producer
-- may re-send freely: a retry inserts only what is genuinely missing. This is #521's second
-- scope bullet ("make delivery idempotent end to end — a dedupe key carried from producer to
-- public.notifications — so a blind retry is always safe"), delivered for the broadcast path.
-- It also gives fan-out the means to push exactly once: the insert RETURNs only rows it actually
-- created, and only those recipients are pushed, so a re-run pushes nobody.
--
-- The index is PARTIAL (`where dedupe_key is not null`) because every existing producer writes
-- no dedupe key and must keep being able to write two identical rows — «Hai un Momento» twice is
-- two real Momenti, not a duplicate. Only a keyed row is deduped.

-- ── 1. the row-level dedupe key ──────────────────────────────────────────────────────────────
alter table public.notifications
  add column dedupe_key text;

comment on column public.notifications.dedupe_key is
  'Optional idempotency key (#521). NULL for every one-recipient producer, where two identical '
  'rows are two real events. Set by broadcast producers to a stable (edition, event, slot) '
  'string so a re-send after a fan-out 5xx inserts only what is missing. Unique per recipient '
  'while not null; service-role written like the rest of the row.';

-- Partial: NULL keys are not deduped against each other (NULLs are distinct in a unique index
-- anyway, but the predicate also keeps the index off the ~all-NULL majority of the table).
create unique index notifications_recipient_dedupe
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;

-- No grant change. `notifications` is one of the seven tables carrying column-level ACLs
-- (authenticated holds SELECT + UPDATE(read_at) only), and `revoke all on table` here would drop
-- those — see CLAUDE.md rule and 0121. A new column is covered by the existing table-level
-- SELECT and is NOT added to the UPDATE(read_at) column grant, so it stays client-unwritable.

-- ── 2. 'fundMilestone' re-enters the closed type set ─────────────────────────────────────────
-- The fifth migration to restate both CHECKs, after 20260620025158, 20260813135602,
-- 20260813162227 and 20260822115759. Exactly reverses #241's narrowing: one type back, nine
-- total. Countdown copy rides this same type under a second template key rather than a second
-- type — one lead, one glyph, one prefs toggle. See packages/schemas/src/notification.ts.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation','gdprExport'));

alter table public.notification_preferences drop constraint notification_preferences_type_check;
alter table public.notification_preferences add constraint notification_preferences_type_check
  check (type in ('moment','dreamMilestone','review','eventReminder','fundMilestone',
                  'projectResponse','connection','moderation','gdprExport'));

-- ── 3. the audience enqueue ──────────────────────────────────────────────────────────────────
-- Sibling of athanor.enqueue_notification (20260810103721): same guarded-no-op shape, same
-- runtime_setting pair, same edge_auth_headers (the secret rides `apikey`, never Authorization —
-- the platform parses a bearer token as a JWT and a secret key is not one). The difference is
-- the body: an audience selector instead of a recipient, plus the mandatory dedupe_key.
--
-- p_audience is a NAMED selector resolved inside the edge function, not a predicate passed from
-- SQL. A caller-supplied predicate would be an injection surface and would put the eligibility
-- rules in two places; a name keeps "who is eligible" in exactly one.
create or replace function athanor.enqueue_audience_notification(
  p_audience text,
  p_type text,
  p_template_key text,
  p_params jsonb,
  p_entity_ref jsonb,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := athanor.runtime_setting('notification_fanout_url');
  v_key text := athanor.runtime_setting('notification_fanout_key');
begin
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return; -- fan-out not configured (pre-deploy) → no-op, never block the source write
  end if;
  if p_dedupe_key is null or p_dedupe_key = '' then
    raise exception 'enqueue_audience_notification requires a dedupe_key';
  end if;
  perform net.http_post(
    url := v_url,
    headers := athanor.edge_auth_headers(v_key),
    body := jsonb_build_object(
      'audience', p_audience,
      'type', p_type,
      'template_key', p_template_key,
      'params', coalesce(p_params, '{}'::jsonb),
      'entity_ref', p_entity_ref,
      'dedupe_key', p_dedupe_key
    )
  );
end;
$$;

comment on function athanor.enqueue_audience_notification(text, text, text, jsonb, jsonb, text) is
  'Broadcast sibling of athanor.enqueue_notification (#127). POSTs ONE audience request to '
  'notification-fan-out, which resolves the named audience and writes a row per eligible member. '
  'dedupe_key is mandatory: it is what makes a re-send after a 5xx safe (#521). Guarded no-op '
  'while the fan-out Vault pair is unset, so an unconfigured project broadcasts nothing rather '
  'than believing it did.';

-- Not a client API: only DB producers call it. Follows enqueue_notification / enqueue_score_award.
revoke execute on function athanor.enqueue_audience_notification(text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;
