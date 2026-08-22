import type { MessageKey } from '@athanor/i18n';
import type { Notification } from '@athanor/schemas';

/**
 * Per-type visual config for notification rows (M9 §3.6).
 *
 * `glyph`: a Unicode text character from the esoteric set used across the app.
 * No dedicated Glyph component exists yet (Foundation debt) — rendered as a <Text>
 * inside the accent circle.
 *
 * `accentClass`: NativeWind token class for the ndot circle background.
 * `moment` is the ONLY celebratory (cyan `aura-soft`) accent — rule #4 glow discipline.
 * All other types use the neutral `raise-2` fill.
 *
 * Glyph substitutions (plan used non-existent named glyphs; Unicode equivalents used):
 *  sun      → ✦  (kairos spark — the project's signature mark)
 *  sprout   → ◉  (filled circle — growth)
 *  feather  → ◇  (diamond — review/quality)
 *  sundot   → ◷  (clock face — reminder)
 *  vesica2  → ◈  (diamond in square — projects)
 *  link     → ◌  (dashed circle — connection)
 *  triangle → △  (outline triangle — moderation warn, #313)
 *  triangle2→ ▽  (down triangle — your data coming to you, #129)
 */
type Visual = { glyph: string; accentClass: string; celebratory: boolean };

export const NOTIF_VISUAL: Record<Notification['type'], Visual> = {
  moment: { glyph: '✦', accentClass: 'bg-aura-soft', celebratory: true },
  dreamMilestone: { glyph: '◉', accentClass: 'bg-raise-2', celebratory: false },
  review: { glyph: '◇', accentClass: 'bg-raise-2', celebratory: false },
  eventReminder: { glyph: '◷', accentClass: 'bg-raise-2', celebratory: false },
  projectResponse: { glyph: '◈', accentClass: 'bg-raise-2', celebratory: false },
  connection: { glyph: '◌', accentClass: 'bg-raise-2', celebratory: false },
  // #313 warn verdicts — neutral fill like every non-moment type; a sanction is not a moment.
  moderation: { glyph: '△', accentClass: 'bg-raise-2', celebratory: false },
  // #129 export ready — neutral: a delivery notice is service, not a moment (rule #4).
  gdprExport: { glyph: '▽', accentClass: 'bg-raise-2', celebratory: false },
};

/** Maps each type to the i18n lead key (bold prefix on the row). Typed MessageKey so a lead
 *  that leaves the catalog fails typecheck here instead of degrading at render (#113). */
export const NOTIF_LEAD: Record<Notification['type'], MessageKey> = {
  moment: 'notif.type.moment',
  dreamMilestone: 'notif.type.dreamMilestone',
  review: 'notif.type.review',
  eventReminder: 'notif.type.eventReminder',
  projectResponse: 'notif.type.projectResponse',
  connection: 'notif.type.connection',
  moderation: 'notif.type.moderation',
  gdprExport: 'notif.type.gdprExport',
};

/** Per-template lead overrides, checked before NOTIF_LEAD. The help* templates reuse type
 *  'dreamMilestone' but notify the HELPER (#125) — the type lead («Una tappa del tuo sogno»)
 *  addresses the dream owner and would misread on their rows. */
export const NOTIF_LEAD_BY_TEMPLATE: Partial<Record<Notification['template_key'], MessageKey>> = {
  'notif.tpl.helpAccepted': 'notif.lead.help',
  'notif.tpl.helpConfirmed': 'notif.lead.help',
};
