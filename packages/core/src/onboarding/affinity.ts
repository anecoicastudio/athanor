import type { Profession } from './professions';
import type { IdentityTag, SeekingTag } from './tags';

/**
 * Momenti affinity (PRD §4.7) — the DATA the matcher scores with, and nothing else.
 *
 * There used to be a TypeScript engine here too (`momentoAffinityTerms`,
 * `momentoAffinity`, and the three helpers under them), shadowing the SQL that actually
 * ranks Momenti. It had zero callers outside its own tests and it could not acquire one:
 * every field it needs — `profiles.visibility`, the gated identity columns, verified
 * check-ins — is unreadable by `authenticated` since the M10 column grant. #334 ruled it
 * away and #384 removed it: `athanor.momento_terms()` is the engine, `supabase/tests/`
 * is where its behaviour is asserted.
 *
 * What stays is the part a migration cannot own. A map is a PRODUCT ruling — which crafts
 * ship things together, which identities answer which intent — and rulings are made and
 * argued in TypeScript, where they can carry a comment and a structural test. The SQL
 * copies (`athanor.seeking_to_identity`, `athanor.profession_complements`) are copies;
 * `affinity.mirror.test.ts` compares them to these BY VALUE and fails when either side
 * moves alone.
 *
 * The tunables below work the same way, through `athanor.momento_affinity_constants()`.
 * A retune is a one-line edit here plus a new migration — never one side alone.
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
 * `athanor.profession_complements()` carries the same pairs in SQL;
 * `affinity.mirror.test.ts` asserts the two copies agree, pair for pair.
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
 * Term weights (rule 10 shape): named constants, mirrored into
 * `athanor.momento_affinity_constants()`. All start at parity (#123) — each shared skill
 * counts like a shared tag, and city proximity counts once, like one tag. Retuning is a
 * product decision made on data; this makes it a one-line edit, not a rewrite.
 */
export const AFFINITY_WEIGHTS = {
  /** Per element of the `shared` / `seek_hit` / `offer_hit` term arrays. */
  tag: 1,
  /** Per element of `skills_shared`. */
  skill: 1,
  /** Once, when the two geohash cells agree at `CITY_GEOHASH_MATCH_PRECISION`. */
  city: 1,
  /** Per element of `mutual_activity`, up to `MUTUAL_ACTIVITY_CAP` of them (#361). */
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
