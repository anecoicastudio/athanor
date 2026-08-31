import { z } from 'zod';

// Mirrors supabase/migrations/20260831123550_report_queue_alert.sql, the current
// statement of both CHECKs (06 §2.11, 09 §2.6).
// The 10 canonical notification types — must match notification_preferences.type. NOT the same
// set as the M9 prefs UI, and deliberately: 'connection', 'moderation', 'gdprExport' and
// 'reportQueue' carry no PREF_ROWS toggle, each for a reason stated at its entry below.
// Two of them have no producer yet; that is intentional, not a broken fan-out (see below).
//
// When a producerless type is KEPT vs DELETED: it stays when only the producer is missing and
// the surface that will ship it is named — the two PARKED entries below. 'fundMilestone' was
// deleted instead (#241), because it was not waiting on a producer but on a MECHANISM that did
// not exist: a fund-wide broadcast has no single recipient and athanor.enqueue_notification was
// one-recipient-per-call, which is why 20260701160235 skipped fund_aggregates outright.
// #127 built that mechanism (athanor.enqueue_audience_notification + the fan-out's audience
// mode) and re-added the type with its two producers, so the deletion's own condition is met.
export const NOTIFICATION_TYPES = [
  'moment',
  'dreamMilestone',
  // PARKED(reviews): nothing emits this — human reviews are Fase 3. The profile section
  // renders a literal em-dash ((modal)/user/[id].tsx) and the `recensioni` Aura bucket has no
  // BUCKET_MAP entry, so it is structurally 0. The prefs toggle for it already exists in
  // PREF_ROWS (inert until a producer lands — don't rebuild it with the surface).
  // Ships with the reviews surface (PRODUCTION-READINESS P5).
  'review',
  'eventReminder',
  // #127: the fund's broadcasts — a milestone crossing (fund_aggregates trigger) and the
  // countdown slots (fund_countdown_sweep). ONE type carrying several template keys rather than
  // one type each: they share a lead, a glyph, a route and a prefs toggle, and only the sentence
  // differs. Unlike 'moderation'/'gdprExport' this IS mutable — it is a broadcast about the
  // community, not a notice about the member — so it has a PREF_ROWS entry (notif.prefs.fund).
  'fundMilestone',
  // PARKED(project-response): the consumer side is fully wired — prefs toggle, route to
  // (tabs)/costellazioni, notif template — and only the producer is missing, because the
  // only CTA on a project is currently a toast (#133). Ships with that surface.
  'projectResponse',
  'connection',
  // Governance notices (#313, upheld warn verdicts). Deliberately NO PREF_ROWS entry — like
  // 'connection', it has no per-type mute: the in-app row always lands, push obeys only the
  // master toggle. A member must not be able to silence their own warnings via an unrelated
  // preference, which is why this is a new type rather than a reuse.
  'moderation',
  // «Your archive is ready» (#129, gdpr_export_jobs status→ready). Same no-PREF_ROWS stance
  // as 'moderation': the delivery of a member's own data must not be mutable by type.
  'gdprExport',
  // #602: the moderation queue alert. Its recipient is not a member but the WATCHER — the
  // admin role, read from app_metadata — so it is the one type in this set that is never
  // about the person receiving it. A new type rather than a template key on 'moderation'
  // for the reason stated at the top of this list: a second key rides an existing type only
  // when lead, glyph, route and toggle are shared, and 'moderation' is a notice TO a
  // sanctioned member («Un richiamo», the warning triangle). Same no-PREF_ROWS stance as
  // 'moderation' and 'gdprExport', for a sibling reason: a watcher must not be able to
  // silence the moderation queue from a preferences screen.
  'reportQueue',
] as const;
export const notificationType = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationType>;

// Routing target for a tapped notification, e.g. {"kind":"momento","id":"…"}.
// `.nullish()` — the DB column is nullable and realtime may emit null (M6 nullish trap).
export const entityRefSchema = z.object({ kind: z.string(), id: z.string() }).nullish();
export type EntityRef = z.infer<typeof entityRefSchema>;

// The notif.tpl.* keys the fan-out writes. Mirrored in @athanor/i18n catalogs (that half
// is asserted by an i18n test) and in supabase/functions/_shared/notif-templates.ts — Deno,
// not importable from Vitest, so `notification-templates.mirror.test.ts` asserts the coverage
// half by reading that file as text (#553). Its own notif-templates.test.ts still exercises
// each template's CONTENT, but from a hand-written case list that cannot see this array — so
// a template added here must join the Deno TEMPLATES literal and that case list both.
// `notif.tpl.generic` is client-only: the degrade target, never written server-side, and the
// one key the mirror is allowed to omit.
export const NOTIFICATION_TEMPLATE_KEYS = [
  'notif.tpl.moment',
  'notif.tpl.message',
  'notif.tpl.dreamMilestone',
  'notif.tpl.review',
  // #126 sends two reminder slots and #523 gave them separate copy: t24 keeps the neutral
  // «è tra poco», t1 says the hour. #522 adds a third, org_t1 — the organiser's own reminder at
  // the hour, sent whether or not they RSVP'd. All three ride type 'eventReminder' — the split
  // is copy, not routing, so the push route map and the in-app router are untouched.
  'notif.tpl.eventReminder',
  'notif.tpl.eventReminderSoon',
  'notif.tpl.eventReminderOrganizer',
  'notif.tpl.projectResponse',
  'notif.tpl.connection',
  'notif.tpl.connectionAccepted',
  'notif.tpl.helpAccepted',
  'notif.tpl.helpConfirmed',
  // #313: one per upheld warn verdict. `reason` param is a reports.category TOKEN — the
  // client localizes it via report.reason.* (displayParams), the push mirror via its own map.
  'notif.tpl.warn',
  // #129: gdpr_export_jobs status→ready — no params; the row routes to Settings → Data Export.
  'notif.tpl.gdprExport',
  // #127, all five on type 'fundMilestone'. The split is grammatical, not semantic: `t()` does
  // plain {name} interpolation with no plural support, so «Mancano {days} giorni» cannot serve
  // the 1-day slot — «Mancano 1 giorni» is not Italian. Hence a *Countdown key for the plural
  // slots (7, 3) and a *LastDay key with the number written into the sentence.
  'notif.tpl.fundMilestone',
  'notif.tpl.fundAnnounceCountdown',
  'notif.tpl.fundAnnounceLastDay',
  'notif.tpl.fundBallotCountdown',
  'notif.tpl.fundBallotLastDay',
  // #602, both on type 'reportQueue'. The split is grammatical, exactly as the fund's
  // *Countdown/*LastDay pair: `t()` interpolates {count} with no plural support, so
  // «Ci sono 1 segnalazioni» cannot be served by the plural key. Neither carries a report
  // id, a handle or any note text — the params are a count and nothing else (#97 scopes the
  // admin read path to reported content, and push params render on a lock screen).
  'notif.tpl.reportQueue',
  'notif.tpl.reportQueueOne',
  'notif.tpl.generic',
] as const;
export const notificationTemplateKey = z.enum(NOTIFICATION_TEMPLATE_KEYS);
export type NotificationTemplateKey = z.infer<typeof notificationTemplateKey>;

// Recipient reads OWN rows; written ONLY by the fan-out edge fn (service role). Body copy is a
// template_key + params (server-composed, IT/EN — 09 §3.6), never a hardcoded string.
export const notificationSchema = z.object({
  id: z.string().uuid(),
  recipient_id: z.string().uuid(),
  type: notificationType,
  // `.catch`, not a bare enum: a key this build has never seen (an old client after #125
  // ships new templates) must degrade to the generic template, not fail the page parse (#113).
  template_key: notificationTemplateKey.catch('notif.tpl.generic'),
  params: z.record(z.string(), z.unknown()).default({}),
  entity_ref: entityRefSchema,
  read_at: z.string().nullish(),
  created_at: z.string(),
  // #180: read_at is client-updatable, so the row changes; updated_at records when. NOT NULL in
  // the DB (20260821164731) and written only by the touch trigger — authenticated holds
  // update(read_at) alone, so this value cannot be forged by the client that flipped it.
  updated_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

/**
 * One abandoned notification dispatch, as `admin_list_abandoned_dispatches` returns it (#534).
 *
 * The read side of #521's outbox: a row lands here only after a dispatch has spent its whole
 * retry budget (three attempts a minute apart) or returned the one deterministic 400, so the
 * population is small by construction — a single row is already a signal rather than a
 * dashboard number.
 *
 * `payload` is deliberately absent: it is the exact notification body that was POSTed, and the
 * question this surface answers is whether delivery was lost, not what the message said.
 * `last_status` and `last_error` are both nullable — a dispatch abandoned on a transport error
 * never got a status, and one abandoned on a status never got an error string. Parsed at the
 * boundary rather than cast (rules/api.md), so a malformed row is withheld and counted instead
 * of faking a clean audit page.
 */
export const abandonedDispatchRowSchema = z.object({
  id: z.string().uuid(),
  request_id: z.number(),
  attempts: z.number().int(),
  last_status: z.number().int().nullable(),
  last_error: z.string().nullable(),
  abandoned_at: z.string(),
  created_at: z.string(),
});
export type AbandonedDispatchRow = z.infer<typeof abandonedDispatchRowSchema>;
