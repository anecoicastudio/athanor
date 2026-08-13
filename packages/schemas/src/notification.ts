import { z } from 'zod';

// Mirrors supabase/migrations/20260620025158_m9_notifications.sql (06 §2.11, 09 §2.6).
// The 7 canonical notification types — must match notification_preferences.type + the M9 prefs UI.
// Two of them have no producer yet; that is intentional, not a broken fan-out (see below).
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
  'notif.tpl.fundMilestone',
  'notif.tpl.projectResponse',
  'notif.tpl.connection',
  'notif.tpl.connectionAccepted',
  'notif.tpl.helpAccepted',
  'notif.tpl.helpConfirmed',
  // #313: one per upheld warn verdict. `reason` param is a reports.category TOKEN — the
  // client localizes it via report.reason.* (displayParams), the push mirror via its own map.
  'notif.tpl.warn',
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
});
export type Notification = z.infer<typeof notificationSchema>;
