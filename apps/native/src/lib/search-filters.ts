import { searchFiltersSchema, type SearchFilters } from '@athanor/schemas';

/**
 * The route-param contract between the advanced-filter sheet and the search screen
 * (M8 §3.5). The sheet serializes its draft into string params and `dismissTo`s back
 * to /search; the search screen re-derives `SearchFilters` from `useLocalSearchParams`
 * and re-runs the query. Both halves live here so the enum and the encoding cannot
 * drift apart across the two screens.
 */

/** Aura buckets offered by the sheet — `any` means "no minimum". */
export type AuraBucket = 'any' | '500' | '700' | '850';

export const AURA_BUCKETS: AuraBucket[] = ['any', '500', '700', '850'];

export type StarValue = NonNullable<SearchFilters['star']>;

export const STAR_VALUES: StarValue[] = [
  'visionario',
  'creatore',
  'mentor',
  'innovatore',
  'collaboratore',
  'ambasciatore',
];

export function auraMinFromBucket(bucket: AuraBucket): number | undefined {
  if (bucket === 'any') return undefined;
  return Number(bucket);
}

export function bucketFromAuraMin(auraMin?: string): AuraBucket {
  if (!auraMin) return 'any';
  if (auraMin === '500') return '500';
  if (auraMin === '700') return '700';
  if (auraMin === '850') return '850';
  return 'any';
}

/** Narrow a raw param to the star enum; anything else is ignored (defence-in-depth). */
export function parseStar(raw?: string): StarValue | undefined {
  return raw !== undefined && (STAR_VALUES as string[]).includes(raw)
    ? (raw as StarValue)
    : undefined;
}

/** Route params the two screens exchange — every value is a string, or absent. */
export type SearchFilterParams = {
  auraMin?: string;
  city?: string;
  star?: string;
};

/**
 * Filters → route params. Absent/empty values are omitted entirely rather than
 * written as empty strings, so an unfiltered search carries no params at all.
 */
export function serializeFilters(filters: SearchFilters): SearchFilterParams {
  const params: SearchFilterParams = {};
  if (filters.auraMin !== undefined) params.auraMin = String(filters.auraMin);
  const filledCity = filters.city?.trim();
  if (filledCity) params.city = filledCity;
  if (filters.star) params.star = filters.star;
  return params;
}

/**
 * Narrow a raw param to the schema's auraMin (int 0..1000); anything else is ignored.
 * Route params are attacker-controlled — a deep link carries whatever the URL says — so the
 * bound comes from `searchFiltersSchema`, the single validation source, not from a literal here.
 */
export function parseAuraMin(raw?: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = searchFiltersSchema.shape.auraMin.safeParse(Number(raw));
  return parsed.success ? parsed.data : undefined;
}

/**
 * Route params → filters. Returns `undefined` when nothing is set, which is what
 * the query key and the "filters applied" dot both read as "unfiltered".
 */
export function parseFilters(params: SearchFilterParams): SearchFilters | undefined {
  const auraMin = parseAuraMin(params.auraMin);
  const city = params.city ?? undefined;
  const star = parseStar(params.star);
  if (auraMin === undefined && city === undefined && star === undefined) return undefined;
  return { auraMin, city, star };
}
