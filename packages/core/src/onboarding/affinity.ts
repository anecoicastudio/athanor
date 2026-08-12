import { IDENTITY_TAGS, type IdentityTag, SEEKING_TAGS, type SeekingTag } from './tags';

/**
 * Momenti affinity (PRD §4.7), the tag half of it.
 *
 * The two vocabularies in `tags.ts` are DISJOINT, so intersecting `seeking` with
 * `identity_tags` directly can only ever return the empty set — which is what the
 * matcher did until #273: two of its three terms were structurally dead and affinity
 * collapsed to "same identity label". This module is the missing translation: what a
 * member SEEKS, expressed as the identities that answer it.
 *
 * `run_momenti_matcher()` carries the same map in SQL (`public.seeking_to_identity`);
 * `affinity.mirror.test.ts` asserts the two copies agree, so this file stays the
 * source of truth.
 */
export const SEEKING_TO_IDENTITY: Readonly<Record<SeekingTag, readonly IdentityTag[]>> = {
  // Generic intents: no profession answers them, so no complementarity term. Mapping
  // these to the whole vocabulary would score every pair — the failure mode #273 C
  // describes, arrived at from the other direction.
  connessioni: [],
  eventi: [],
  // Someone to build WITH: the makers.
  collaborazioni: ['artista', 'creativo', 'freelance'],
  // Someone to grow THROUGH: the guides. Same shape as mentorship, deliberately —
  // «crescita» is the softer word for it, not a different need.
  crescita: ['coach', 'mentor'],
  // Someone to build a BUSINESS with or through: capital and the people who deploy it.
  business: ['imprenditore', 'investitore'],
  mentorship: ['coach', 'mentor'],
};

/** A proposal ships only at this many terms or more (#273 C — `affinity > 0` was noise). */
export const MOMENTO_AFFINITY_THRESHOLD = 2;

/** The two sides of a candidate pair, already visibility-masked by the caller. */
export type AffinityProfile = {
  identityTags: readonly string[];
  seeking: readonly string[];
};

/** The three affinity terms, each a list of IDENTITY tag keys the UI can localize. */
export type AffinityTerms = {
  /** Identities you both claim. */
  shared: IdentityTag[];
  /** Identities they claim that answer what you seek. */
  seekHit: IdentityTag[];
  /** Identities you claim that answer what they seek. */
  offerHit: IdentityTag[];
};

const isIdentityTag = (tag: string): tag is IdentityTag =>
  (IDENTITY_TAGS as readonly string[]).includes(tag);

const isSeekingTag = (tag: string): tag is SeekingTag =>
  (SEEKING_TAGS as readonly string[]).includes(tag);

/** Sorted, deduplicated intersection — stable output is what makes the terms diffable. */
function intersect(a: readonly IdentityTag[], b: readonly IdentityTag[]): IdentityTag[] {
  const other = new Set(b);
  return [...new Set(a.filter((tag) => other.has(tag)))].sort();
}

const identitiesOf = (tags: readonly string[]): IdentityTag[] => tags.filter(isIdentityTag);

/** The identities that answer a member's seeking list. Unknown keys are dropped. */
export function expandSeeking(seeking: readonly string[]): IdentityTag[] {
  const out = new Set<IdentityTag>();
  for (const tag of seeking) {
    if (!isSeekingTag(tag)) continue;
    for (const identity of SEEKING_TO_IDENTITY[tag]) out.add(identity);
  }
  return [...out].sort();
}

/**
 * The three terms for one directed pair (me → them). Directed, not symmetric:
 * `seekHit` and `offerHit` swap when the pair is scored the other way round.
 */
export function momentoAffinityTerms(me: AffinityProfile, them: AffinityProfile): AffinityTerms {
  const myIdentity = identitiesOf(me.identityTags);
  const theirIdentity = identitiesOf(them.identityTags);
  return {
    shared: intersect(myIdentity, theirIdentity),
    seekHit: intersect(expandSeeking(me.seeking), theirIdentity),
    offerHit: intersect(myIdentity, expandSeeking(them.seeking)),
  };
}

/** Affinity is the count of terms that fired — every term weighs the same (rule 10 shape). */
export function momentoAffinity(terms: AffinityTerms): number {
  return terms.shared.length + terms.seekHit.length + terms.offerHit.length;
}
