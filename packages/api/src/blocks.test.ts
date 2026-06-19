import { describe, expect, it } from 'vitest';
import { blockKeys } from './blocks';

describe('blockKeys', () => {
  it('namespaces under blocks and derives stable sub-keys', () => {
    expect(blockKeys.all).toEqual(['blocks']);
    expect(blockKeys.list()).toEqual(['blocks', 'list']);
    expect(blockKeys.count()).toEqual(['blocks', 'count']);
    expect(blockKeys.status('p1')).toEqual(['blocks', 'status', 'p1']);
  });
});
