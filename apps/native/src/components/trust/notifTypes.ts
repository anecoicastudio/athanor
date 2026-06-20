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
 *  ankh     → ◎  (ring/circle — fund milestone)
 *  vesica2  → ◈  (diamond in square — projects)
 *  link     → ◌  (dashed circle — connection)
 */
type Visual = { glyph: string; accentClass: string; celebratory: boolean };

export const NOTIF_VISUAL: Record<Notification['type'], Visual> = {
  moment: { glyph: '✦', accentClass: 'bg-aura-soft', celebratory: true },
  dreamMilestone: { glyph: '◉', accentClass: 'bg-raise-2', celebratory: false },
  review: { glyph: '◇', accentClass: 'bg-raise-2', celebratory: false },
  eventReminder: { glyph: '◷', accentClass: 'bg-raise-2', celebratory: false },
  fundMilestone: { glyph: '◎', accentClass: 'bg-raise-2', celebratory: false },
  projectResponse: { glyph: '◈', accentClass: 'bg-raise-2', celebratory: false },
  connection: { glyph: '◌', accentClass: 'bg-raise-2', celebratory: false },
};

/** Maps each type to the i18n lead key (bold prefix on the row). */
export const NOTIF_LEAD: Record<Notification['type'], string> = {
  moment: 'notif.type.moment',
  dreamMilestone: 'notif.type.dreamMilestone',
  review: 'notif.type.review',
  eventReminder: 'notif.type.eventReminder',
  fundMilestone: 'notif.type.fundMilestone',
  projectResponse: 'notif.type.projectResponse',
  connection: 'notif.type.connection',
};
