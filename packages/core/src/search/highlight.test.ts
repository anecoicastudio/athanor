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
