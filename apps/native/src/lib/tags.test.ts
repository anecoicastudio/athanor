import { describe, expect, it } from 'vitest';
import { IDENTITY_TAGS, PROFESSIONS, SEEKING_TAGS, SKILLS } from '@athanor/core';
import { tagLabel } from '@athanor/i18n';
import { toggleTag } from './tags';

describe('toggleTag', () => {
  it('adds a tag that is absent', () => {
    expect(toggleTag(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('appends rather than prepends, so the picker order is stable', () => {
    expect(toggleTag(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('removes a tag that is present', () => {
    expect(toggleTag(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('removes every occurrence, so a list that already drifted cannot keep a ghost', () => {
    expect(toggleTag(['a', 'b', 'b'], 'b')).toEqual(['a']);
  });

  it('adds to an empty list', () => {
    expect(toggleTag([], 'a')).toEqual(['a']);
  });

  it('does not mutate its input', () => {
    const list = ['a', 'b'];
    toggleTag(list, 'c');
    toggleTag(list, 'a');
    expect(list).toEqual(['a', 'b']);
  });
});

/**
 * The curated lists live in `@athanor/core` and their labels in `@athanor/i18n`, and neither
 * package may import the other — so the only place both are in reach is an app. A list value
 * with no label renders as the stored key itself through `tagLabel`'s fallback (#883): legible,
 * but untranslated, on every picker and profile that offers it.
 */
describe('every curated tag has a label in both catalogs', () => {
  const lists = [
    ['identity', IDENTITY_TAGS],
    ['seeking', SEEKING_TAGS],
    ['skill', SKILLS],
    ['profession', PROFESSIONS],
  ] as const;

  it.each(lists)('%s', (kind, values) => {
    const unlabelled = values.flatMap((v) =>
      (['it', 'en'] as const)
        .filter((locale) => tagLabel(kind, v, locale) === v)
        .map((locale) => `${locale}: tag.${kind}.${v}`),
    );
    expect(unlabelled).toEqual([]);
  });
});
