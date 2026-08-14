/**
 * Curated profession vocabulary (#149, PRD §4.2). Single-select: exactly one
 * key lands in profiles.profession. Keys are stable identifiers in the Italian
 * register (like `imprenditore` in tags.ts); display labels live in
 * @athanor/i18n (tag.profession.*). The future affinity term (#123) compares
 * these keys across users — do not free-text.
 */
export const PROFESSIONS = [
  'design',
  'sviluppo',
  'arte',
  'musica',
  'scrittura',
  'foto-video',
  'marketing',
  'comunicazione',
  'business',
  'finanza',
  'legale',
  'educazione',
  'artigianato',
  'ricerca',
  'benessere',
  'food',
] as const;

export type Profession = (typeof PROFESSIONS)[number];

export function isProfession(value: string): value is Profession {
  return (PROFESSIONS as readonly string[]).includes(value);
}
