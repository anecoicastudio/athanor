import { describe, expect, it } from 'vitest';
import { favorKeys } from './favors';

describe('favorKeys', () => {
  it('namespaces openNeeds + incoming + mine distinctly', () => {
    expect(favorKeys.all).toEqual(['favorOffers']);
    expect(favorKeys.openNeeds).toEqual(['favorOffers', 'openNeeds']);
    expect(favorKeys.incoming('t1')).toEqual(['favorOffers', 'incoming', 't1']);
    expect(favorKeys.mine('a1')).toEqual(['favorOffers', 'mine', 'a1']);
  });
});
