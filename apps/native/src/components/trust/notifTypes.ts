import type { MessageKey } from '@athanor/i18n';
import type { Notification } from '@athanor/schemas';

/**
 * The glyph of each notification type (M9 §3.6): a Unicode character from the esoteric set,
 * drawn in the 30pt disc that leads the row. No dedicated Glyph component exists yet
 * (Foundation debt), so it is a `<Text>`.
 *
 * A glyph is all a type draws since 2026-10-06 (#921). Before Galleria each type also chose
 * the disc's fill, and exactly one type (`moment`) and one template (`notif.tpl.helpConfirmed`,
 * #637) took the cyan `aura-soft` one. On mobile cyan is five marks (DESIGN §2.3): the row of
 * a waiting Momento leads with the 8px dot instead of a disc (`NotificationRow`), and every
 * other row, the confirmed help and the fund's broadcasts (#127) included, is the same grey
 * disc. `helpConfirmed` keeps its own LEAD below; its glyph was its type's already.
 *
 * Glyph substitutions (plan used non-existent named glyphs; Unicode equivalents used):
 *  sun      → ✦  (the spark — the project's signature mark)
 *  sprout   → ◉  (filled circle — growth)
 *  feather  → ◇  (diamond — review/quality)
 *  sundot   → ◷  (clock face — reminder)
 *  vesica2  → ◈  (diamond in square — projects)
 *  link     → ◌  (dashed circle — connection)
 *  triangle → △  (outline triangle — moderation warn, #313)
 *  triangle2→ ▽  (down triangle — your data coming to you, #129)
 *  azoth    → ◐  (half-filled circle — the vessel filling: the fund, #127)
 *  eye      → ◎  (circle within circle — the iris: the watcher, #602; `eye` from the
 *                 20-glyph set, DESIGN.md §6)
 */
export const NOTIF_GLYPH: Record<Notification['type'], string> = {
  moment: '✦',
  dreamMilestone: '◉',
  review: '◇',
  eventReminder: '◷',
  fundMilestone: '◐',
  projectResponse: '◈',
  connection: '◌',
  moderation: '△',
  gdprExport: '▽',
  reportQueue: '◎',
};

/** Maps each type to the i18n lead key (bold prefix on the row). Typed MessageKey so a lead
 *  that leaves the catalog fails typecheck here instead of degrading at render (#113). */
export const NOTIF_LEAD: Record<Notification['type'], MessageKey> = {
  moment: 'notif.type.moment',
  dreamMilestone: 'notif.type.dreamMilestone',
  review: 'notif.type.review',
  eventReminder: 'notif.type.eventReminder',
  fundMilestone: 'notif.type.fundMilestone',
  projectResponse: 'notif.type.projectResponse',
  connection: 'notif.type.connection',
  moderation: 'notif.type.moderation',
  gdprExport: 'notif.type.gdprExport',
  reportQueue: 'notif.type.reportQueue',
};

/** Per-template lead overrides, checked before NOTIF_LEAD. The help* templates reuse type
 *  'dreamMilestone' but notify the HELPER (#125) — the type lead («Una tappa del tuo sogno»)
 *  addresses the dream owner and would misread on their rows. */
export const NOTIF_LEAD_BY_TEMPLATE: Partial<Record<Notification['template_key'], MessageKey>> = {
  'notif.tpl.helpAccepted': 'notif.lead.help',
  'notif.tpl.helpConfirmed': 'notif.lead.help',
};
