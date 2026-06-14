import { describe, expect, it } from 'vitest';
import { helpKeys } from './helps';

describe('helpKeys', () => {
  it('namespaces incoming + mine distinctly', () => {
    expect(helpKeys.incoming('p1')).toEqual(['milestoneHelps', 'incoming', 'p1']);
    expect(helpKeys.mine('h1')).toEqual(['milestoneHelps', 'mine', 'h1']);
    expect(helpKeys.all).toEqual(['milestoneHelps']);
  });
});
