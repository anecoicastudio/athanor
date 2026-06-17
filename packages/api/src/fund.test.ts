import { describe, expect, it, vi } from 'vitest';
import { fundKeys, subscribeFundAggregate } from './fund';

describe('fundKeys', () => {
  it('namespaces under "fund" and distinguishes active vs by-id', () => {
    expect(fundKeys.all).toEqual(['fund']);
    expect(fundKeys.activeEdition()).toEqual(['fund', 'edition', 'active']);
    expect(fundKeys.edition('e1')).toEqual(['fund', 'edition', 'e1']);
    expect(fundKeys.aggregate('e1')).toEqual(['fund', 'aggregate', 'e1']);
  });
});

describe('subscribeFundAggregate', () => {
  it('returns a cleanup fn that removes the channel', () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
    const client = { channel: vi.fn().mockReturnValue(channel), removeChannel: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleanup = subscribeFundAggregate(client as any, 'e1', () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
