import { describe, expect, it } from 'vitest';
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
