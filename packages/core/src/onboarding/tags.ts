/**
 * Curated onboarding vocabularies (PRD §4.1). Keys are stable identifiers
 * stored in profiles.identity_tags / profiles.seeking; display labels live
 * in @athanor/i18n (tag.identity.* / tag.seeking.*). The Momenti matcher
 * (PRD §4.7) compares these same keys across users — do not free-text.
 */
export const IDENTITY_TAGS = [
  'imprenditore',
  'freelance',
  'coach',
  'artista',
  'creativo',
  'mentor',
  'investitore',
] as const;

export const SEEKING_TAGS = [
  'connessioni',
  'collaborazioni',
  'crescita',
  'eventi',
  'business',
  'mentorship',
] as const;

export type IdentityTag = (typeof IDENTITY_TAGS)[number];
export type SeekingTag = (typeof SEEKING_TAGS)[number];
