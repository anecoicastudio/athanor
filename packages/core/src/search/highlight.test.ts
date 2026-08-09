import { describe, expect, test } from 'vitest';
import { highlightMatches, type HighlightSpan } from './highlight';

describe('highlightMatches', () => {
  test('basic match splits text into matched and unmatched spans', () => {
    expect(highlightMatches('Videomaker a Milano', 'video')).toEqual([
      { text: 'Video', match: true },
      { text: 'maker a Milano', match: false },
    ]);
  });

  test('case-insensitive: uppercase query matches mixed-case text', () => {
    expect(highlightMatches('Videomaker a Milano', 'VIDEO')).toEqual([
      { text: 'Video', match: true },
      { text: 'maker a Milano', match: false },
    ]);
  });

  test('accent-insensitive: unaccented query matches accented text', () => {
    const result = highlightMatches('Città', 'citta');
    expect(result).toEqual([{ text: 'Città', match: true }]);
  });

  test('accent-insensitive: preserves original characters in returned spans', () => {
    const result = highlightMatches('Città di Milano', 'citta');
    expect(result[0]).toEqual({ text: 'Città', match: true });
    // returned text is original, not stripped
    expect(result[0]?.text).toBe('Città');
  });

  test('multi-token query highlights each token independently', () => {
    const result = highlightMatches('Videomaker a Milano', 'video milano');
    const matchedTexts = result.filter((s) => s.match).map((s) => s.text);
    expect(matchedTexts).toContain('Video');
    expect(matchedTexts).toContain('Milano');
  });

  test('empty query returns single non-match span', () => {
    expect(highlightMatches('Videomaker a Milano', '')).toEqual([
      { text: 'Videomaker a Milano', match: false },
    ]);
  });

  test('whitespace-only query returns single non-match span', () => {
    expect(highlightMatches('Videomaker a Milano', '   ')).toEqual([
      { text: 'Videomaker a Milano', match: false },
    ]);
  });

  test('empty text returns empty array', () => {
    expect(highlightMatches('', 'video')).toEqual([]);
  });

  // With a non-empty query, empty text reaches the same `[]` by a different route (an empty
  // mask produces no spans), so the guard on line 1 was indistinguishable from its absence.
  // Empty text AND empty query is the pair that separates them: without the guard the
  // empty-query branch wins and returns a bogus `[{ text: '', match: false }]` span.
  test('empty text with an empty query is still empty, not a blank span', () => {
    expect(highlightMatches('', '')).toEqual([]);
  });

  // The accent tests above both put the accent inside the match, where a length change in the
  // normalized string cannot shift anything. This puts it BEFORE the match, which is the case
  // the source's own ASSUMPTION comment is about: the mask is indexed by normalized offsets, so
  // if stripping a combining mark changed the string's length the highlight would land wrong.
  test('an accent before the match does not shift the highlight', () => {
    expect(highlightMatches('Città di Milano', 'milano')).toEqual([
      { text: 'Città di ', match: false },
      { text: 'Milano', match: true },
    ]);
  });

  // Same assumption, from the other side. Case folding has to be the direction that preserves
  // length: 'ß'.toUpperCase() is 'SS', one character longer, which would both invent a match
  // that is not there and desynchronise every offset after it. Lowercasing never does this.
  test('case folding does not change length: ß is not a match for ss', () => {
    expect(highlightMatches('Straße', 'strasse')).toEqual([{ text: 'Straße', match: false }]);
  });

  // A query that is nothing but a combining mark is the one input that reaches the
  // empty-normalized-token guard: it has length 1, so `.trim()` and the `length > 0` filter both
  // pass it through, and only normalize() empties it. Without the guard `indexOf('', n)` returns
  // n, `searchFrom` never advances, and the while loop spins forever — on the UI thread, since
  // this runs per keystroke in the search row. Cheap to type by accident on a mobile keyboard.
  test('a query of only a combining mark terminates instead of spinning', () => {
    expect(highlightMatches('Citta', '́')).toEqual([{ text: 'Citta', match: false }]);
  });

  test('no false positives: query with no occurrence returns single non-match span', () => {
    expect(highlightMatches('Videomaker a Milano', 'astronauta')).toEqual([
      { text: 'Videomaker a Milano', match: false },
    ]);
  });

  test('invariant: concatenating all span texts reconstructs the original text exactly', () => {
    const cases: [string, string][] = [
      ['Videomaker a Milano', 'video'],
      ['Città di Milano', 'citta milano'],
      ['Hello World', 'lo or'],
      ['abcabc', 'abc'],
      ['no match here', 'zzz'],
    ];
    for (const [text, query] of cases) {
      const spans = highlightMatches(text, query);
      const reconstructed = spans.map((s) => s.text).join('');
      expect(reconstructed, `text="${text}" query="${query}"`).toBe(text);
    }
  });

  test('overlapping/adjacent matches produce no empty spans', () => {
    const spans = highlightMatches('abcabc', 'abc');
    for (const span of spans) {
      expect(span.text.length, `span text should not be empty`).toBeGreaterThan(0);
    }
  });

  test('match in the middle of text produces three spans', () => {
    const result = highlightMatches('Hello World test', 'World');
    expect(result).toEqual([
      { text: 'Hello ', match: false },
      { text: 'World', match: true },
      { text: ' test', match: false },
    ]);
  });

  test('type HighlightSpan is exported', () => {
    const span: HighlightSpan = { text: 'test', match: false };
    expect(span).toBeDefined();
  });
});
