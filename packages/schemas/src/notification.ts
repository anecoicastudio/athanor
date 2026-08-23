import { z } from 'zod';

// Mirrors supabase/migrations/20260823121933_fund_broadcast_notifications.sql, the current
// statement of both CHECKs (06 §2.11, 09 §2.6).
// The 9 canonical notification types — must match notification_preferences.type + the M9 prefs UI.
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
] as const;
export const notificationType = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationType>;

// Routing target for a tapped notification, e.g. {"kind":"momento","id":"…"}.
// `.nullish()` — the DB column is nullable and realtime may emit null (M6 nullish trap).
export const entityRefSchema = z.object({ kind: z.string(), id: z.string() }).nullish();
export type EntityRef = z.infer<typeof entityRefSchema>;

// The notif.tpl.* keys the fan-out writes. Mirrored in @athanor/i18n catalogs (that half
// is asserted by an i18n test) and in supabase/functions/_shared/notif-templates.ts (manual
// sync — Deno, not importable from Vitest; its own notif-templates.test.ts exercises the
// mirror's content, so a template added here must also join that Deno case list).
// `notif.tpl.generic` is client-only: the degrade target, never written server-side.
export const NOTIFICATION_TEMPLATE_KEYS = [
  'notif.tpl.moment',
  'notif.tpl.message',
  'notif.tpl.dreamMilestone',
  'notif.tpl.review',
  'notif.tpl.eventReminder',
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
