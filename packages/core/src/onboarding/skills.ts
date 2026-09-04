/**
 * Curated skill vocabulary (#149, PRD §4.2 «skills (tags)»). Multi-select:
 * keys land in profiles.skills text[]. Stable identifiers in the Italian
 * register; display labels live in @athanor/i18n (tag.skill.*). The future
 * matcher term (#123) intersects these keys across users — do not free-text
 * (ASCII keys only: `contabilita`, not `contabilità`, so keys stay grep- and
 * URL-safe; the accent lives in the label).
 */
export const SKILLS = [
  'branding',
  'ui-ux',
  'illustrazione',
  'grafica-3d',
  'sviluppo-web',
  'sviluppo-mobile',
  'ai-ml',
  'dati',
  'no-code',
  'produzione-musicale',
  'sound-design',
  'videomaking',
  'fotografia',
  'montaggio',
  'copywriting',
  'storytelling',
  'traduzione',
  'social-media',
  'seo',
  'advertising',
  'pr',
  'vendite',
  'fundraising',
  'contabilita',
  'contrattualistica',
  'project-management',
  'facilitazione',
  'coaching',
  'cucina',
  'falegnameria',
] as const;

/** Mirrors the DB check on profiles.skills (like identity_tags/seeking ≤ 10). */
export const MAX_SKILLS = 10;

export type Skill = (typeof SKILLS)[number];

export function isSkill(value: string): value is Skill {
  return (SKILLS as readonly string[]).includes(value);
}
