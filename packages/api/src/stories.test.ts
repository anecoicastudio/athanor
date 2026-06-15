import { describe, expect, it } from 'vitest';
import { storyKeys } from './stories';

describe('storyKeys', () => {
  it('namespaces under "stories"', () => {
    expect(storyKeys.all).toEqual(['stories']);
    expect(storyKeys.rail()).toEqual(['stories', 'rail']);
    expect(storyKeys.person('p1')).toEqual(['stories', 'person', 'p1']);
    expect(storyKeys.reactions('s1')).toEqual(['stories', 'reactions', 's1']);
  });
});
