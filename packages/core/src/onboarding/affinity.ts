import { type Profession, isProfession } from './professions';
import { type IdentityTag, SEEKING_TAGS, type SeekingTag } from './tags';

/**
 * Momenti affinity (PRD §4.7) — the tag terms, the skills overlap and the city
 * proximity (#273, #123).
 *
 * The two vocabularies in `tags.ts` are DISJOINT, so intersecting `seeking` with
 * `identity_tags` directly can only ever return the empty set — which is what the
 * matcher did until #273: two of its three terms were structurally dead and affinity
 * collapsed to "same identity label". This module is the missing translation: what a
 * member SEEKS, expressed as the identities that answer it.
 *
 * `run_momenti_matcher()` carries the same map in SQL (`public.seeking_to_identity`);
 * `affinity.mirror.test.ts` asserts the two copies agree, so this file stays the
 * source of truth. The same contract covers `AFFINITY_WEIGHTS` and
 * `CITY_GEOHASH_MATCH_PRECISION`: the SQL hardcodes their literals, the mirror test
 * pins them, so a retune is one line here plus a new migration — never one side alone.
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

/**
 * Profession complementarity (#361, ruled 2026-08-15): the crafts that ship things
 * TOGETHER — design with the people who build it, business with the people who keep it
 * legal, music with the people who film it. Symmetric sparse pairs, 2–4 complements
 * each, DELIBERATELY: a map where everything complements everything scores every pair,
 * and the term becomes the noise #273 C removed. Same-craft pairs are absent on
 * purpose — «you both are» is the shared-identity terms' signal, not this one's.
 *
 * `run_momenti_matcher()` carries the same pairs in SQL
 * (`athanor.profession_complements`); `affinity.mirror.test.ts` asserts the two copies
 * agree, so this map stays the source of truth.
 */
export const PROFESSION_COMPLEMENTS: Readonly<Record<Profession, readonly Profession[]>> = {
  design: ['artigianato', 'comunicazione', 'marketing', 'sviluppo'],
  sviluppo: ['business', 'design', 'ricerca'],
  arte: ['artigianato', 'comunicazione', 'musica'],
  musica: ['arte', 'foto-video'],
  scrittura: ['comunicazione', 'educazione', 'marketing'],
  'foto-video': ['food', 'marketing', 'musica'],
  marketing: ['business', 'design', 'foto-video', 'scrittura'],
  comunicazione: ['arte', 'design', 'scrittura'],
  business: ['finanza', 'legale', 'marketing', 'sviluppo'],
  finanza: ['business', 'legale'],
  legale: ['business', 'finanza'],
  educazione: ['benessere', 'ricerca', 'scrittura'],
  artigianato: ['arte', 'design', 'food'],
  ricerca: ['educazione', 'sviluppo'],
  benessere: ['educazione', 'food'],
  food: ['artigianato', 'benessere', 'foto-video'],
};

/** A proposal ships only at this many terms or more (#273 C — `affinity > 0` was noise). */
export const MOMENTO_AFFINITY_THRESHOLD = 2;

/**
 * Term weights (rule 10 shape): named constants, mirrored as literals in the matcher
 * SQL, pinned by `affinity.mirror.test.ts`. All start at parity (#123) — each shared
 * skill counts like a shared tag, and city proximity counts once, like one tag.
 * Retuning is a product decision made on data; this makes it a one-line edit, not a
 * rewrite.
 */
export const AFFINITY_WEIGHTS = {
  /** Per element of `shared` / `seekHit` / `offerHit`. */
  tag: 1,
  /** Per element of `skillsShared`. */
  skill: 1,
  /** Once, when the two geohash cells agree at `CITY_GEOHASH_MATCH_PRECISION`. */
  city: 1,
  /** Per element of `mutualActivity`, up to `MUTUAL_ACTIVITY_CAP` of them (#361). */
  activity: 1,
  /** Once, when the pair's professions are complementary per `PROFESSION_COMPLEMENTS` (#361). */
  profession: 1,
} as const;

/**
 * Mutual activity stops counting after this many shared events (#361). The term reads
 * verified check-ins, and a member who attends everything would otherwise carry a few
 * points of affinity with every other regular — the cap keeps shared history a signal,
 * not a volume prize. Scoring only: the term array itself stays the full intersection,
 * so the deck can name every shared event.
 */
export const MUTUAL_ACTIVITY_CAP = 3;

/**
 * City proximity compares geohash PREFIXES at this length (≈ 20 km cell). Deliberately
 * coarser than the stored `CITY_GEOHASH_PRECISION` (5, #149): storing precisely and
 * comparing coarsely is what keeps this tunable without a re-migration of the column.
 */
export const CITY_GEOHASH_MATCH_PRECISION = 4;

/** The two sides of a candidate pair, already visibility-masked by the caller. */
export type AffinityProfile = {
  identityTags: readonly string[];
  seeking: readonly string[];
  /** Curated skill keys (#149); a masked field arrives as `[]` and scores nothing. */
  skills: readonly string[];
  /** Precision-5 geohash, or null — free-text city stores none, masked arrives null. */
  cityGeohash: string | null;
  /**
   * Ids of events this member CHECKED IN at (`event_attendance`, #361) — verified
   * presence, never RSVPs or tickets alone. No visibility knob governs attendance, so
   * there is no masked shape; the caller supplies what the tables record.
   */
  attendedEventIds: readonly string[];
  /** Single curated profession key (#361), or null — unset and masked look the same. */
  profession: string | null;
};

/**
 * The affinity terms. The tag terms and `skillsShared` are lists of tag keys the UI
 * can localize; `cityNear` is a plain fact — the deck RPC surfaces it as a city
 * DISPLAY NAME at most, never a geohash or coordinate (#123).
 *
 * `string[]`, not `IdentityTag[]`/`Skill[]`, and deliberately: `athanor.tag_intersect()` holds
 * no vocabulary list, so a tag predating the curated set (rows carried 'design' / 'music'
 * before #273) intersects like any other. `validate.ts` is what keeps new ones out. Narrowing
 * the type here would describe an engine we do not run, and `tagLabel()` already renders an
 * unknown key as itself rather than «undefined».
 */
export type AffinityTerms = {
  /** Identities you both claim. */
  shared: string[];
  /** Identities they claim that answer what you seek. */
  seekHit: string[];
  /** Identities you claim that answer what they seek. */
  offerHit: string[];
  /** Skills you both claim (#123). */
  skillsShared: string[];
  /** Same ≈20 km geohash cell (#123). */
  cityNear: boolean;
  /**
   * Event ids you both checked in at (#361) — the full intersection; the score caps at
   * `MUTUAL_ACTIVITY_CAP` but the deck names every shared event (as TITLES, resolved
   * server-side — ids never reach the client).
   */
  mutualActivity: string[];
  /**
   * `[mine, theirs]` when the two professions complement each other per
   * `PROFESSION_COMPLEMENTS`, else `[]` (#361). Reader's craft first — the reason line
   * names the pairing, and it scores ONCE, like `cityNear`, whatever its length.
   */
  professionPair: string[];
};

const isSeekingTag = (tag: string): tag is SeekingTag =>
  (SEEKING_TAGS as readonly string[]).includes(tag);

/** Sorted, deduplicated intersection — stable output is what makes the terms diffable. */
function intersect(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return [...new Set(a.filter((tag) => other.has(tag)))].sort();
}

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
 * City proximity: the two precision-5 cells agree on their first
 * `CITY_GEOHASH_MATCH_PRECISION` characters. A missing side (free-text city, masked
 * field) never fires — and never throws. A hash shorter than the match precision can
 * only reach this through a bug (the DB CHECK pins 5 chars) and must not read a
 * 3-char agreement as proximity, so both sides need the full prefix.
 */
export function cityNear(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a.length < CITY_GEOHASH_MATCH_PRECISION || b.length < CITY_GEOHASH_MATCH_PRECISION)
    return false;
  return a.slice(0, CITY_GEOHASH_MATCH_PRECISION) === b.slice(0, CITY_GEOHASH_MATCH_PRECISION);
}

/**
 * Profession complementarity for one directed pair (#361): `[me, them]` when the map
 * holds the pair, else `[]`. A missing side never fires — and neither does a key from
 * outside the vocabulary: `profiles.profession` is app-validated, not CHECK-pinned, so
 * a legacy free-text row must score zero rather than throw. The map is symmetric, so
 * only the ORDER of the returned pair is directed.
 */
export function professionPair(me: string | null, them: string | null): string[] {
  if (me === null || them === null) return [];
  if (!isProfession(me) || !isProfession(them)) return [];
  return PROFESSION_COMPLEMENTS[me].includes(them) ? [me, them] : [];
}

/**
 * The terms for one directed pair (me → them). Directed, not symmetric:
 * `seekHit` and `offerHit` swap when the pair is scored the other way round.
 */
export function momentoAffinityTerms(me: AffinityProfile, them: AffinityProfile): AffinityTerms {
  return {
    shared: intersect(me.identityTags, them.identityTags),
    seekHit: intersect(expandSeeking(me.seeking), them.identityTags),
    offerHit: intersect(me.identityTags, expandSeeking(them.seeking)),
    skillsShared: intersect(me.skills, them.skills),
    cityNear: cityNear(me.cityGeohash, them.cityGeohash),
    mutualActivity: intersect(me.attendedEventIds, them.attendedEventIds),
    professionPair: professionPair(me.profession, them.profession),
  };
}

/** The weighted sum of the terms that fired (`AFFINITY_WEIGHTS` — all at parity today). */
export function momentoAffinity(terms: AffinityTerms): number {
  return (
    AFFINITY_WEIGHTS.tag * (terms.shared.length + terms.seekHit.length + terms.offerHit.length) +
    AFFINITY_WEIGHTS.skill * terms.skillsShared.length +
    (terms.cityNear ? AFFINITY_WEIGHTS.city : 0) +
    AFFINITY_WEIGHTS.activity * Math.min(MUTUAL_ACTIVITY_CAP, terms.mutualActivity.length) +
    (terms.professionPair.length > 0 ? AFFINITY_WEIGHTS.profession : 0)
  );
}
