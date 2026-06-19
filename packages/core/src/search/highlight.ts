/** A single span of text, flagged as matched or unmatched. */
export type HighlightSpan = { text: string; match: boolean };

/** Strip diacritics from a string for accent-insensitive comparison.
 *  The original text is NEVER modified — this is used for matching only. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Split `text` into matched/unmatched spans for `<mark>` highlighting.
 * Matching is case- and accent-insensitive (mirrors the server's f_unaccent/trigram).
 * Returned span `.text` always preserves original characters and casing.
 *
 * @returns An array of spans whose `.text` values concatenate to exactly `text`.
 *          Returns `[]` when `text` is empty.
 *          Returns `[{text, match:false}]` when query is empty/whitespace or has no match.
 */
export function highlightMatches(text: string, query: string): HighlightSpan[] {
  if (text.length === 0) return [];

  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return [{ text, match: false }];

  const normalizedText = normalize(text);

  // Build a boolean mask: matchMask[i] === true means text[i] is inside a match.
  // ASSUMPTION: mask is indexed by NFD-normalized offsets and assumes precomposed BMP input
  // (IT/EN) where normalize() preserves character length/position; non-BMP or fully-decomposed
  // input could cause offset drift between normalizedText and the original text.
  const matchMask = new Uint8Array(text.length); // 0 = not matched, 1 = matched

  for (const token of tokens) {
    const normalizedToken = normalize(token);
    if (normalizedToken.length === 0) continue;

    let searchFrom = 0;
    while (searchFrom < normalizedText.length) {
      const idx = normalizedText.indexOf(normalizedToken, searchFrom);
      if (idx === -1) break;
      for (let i = idx; i < idx + normalizedToken.length; i++) {
        matchMask[i] = 1;
      }
      searchFrom = idx + normalizedToken.length;
    }
  }

  // Walk the mask and group consecutive same-state characters into spans.
  const spans: HighlightSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const isMatch = matchMask[i] === 1;
    let j = i + 1;
    while (j < text.length && (matchMask[j] === 1) === isMatch) {
      j++;
    }
    spans.push({ text: text.slice(i, j), match: isMatch });
    i = j;
  }

  return spans;
}
