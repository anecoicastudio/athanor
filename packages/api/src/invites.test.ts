import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { getInviteStats, getMyReferralCode, inviteKeys } from './invites';

describe('inviteKeys', () => {
  it('namespaces under invites', () => {
    expect(inviteKeys.all).toEqual(['invites']);
    expect(inviteKeys.code()).toEqual(['invites', 'code']);
    expect(inviteKeys.stats()).toEqual(['invites', 'stats']);
  });
});

describe('getMyReferralCode', () => {
  it('returns the RPC payload', async () => {
    const client = {
      rpc: (fn: string) => Promise.resolve({ data: fn === 'ensure_referral_code' ? 'A1B2C3D4' : null, error: null }),
    } as unknown as AthanorClient;
    expect(await getMyReferralCode(client)).toBe('A1B2C3D4');
  });
});

describe('getInviteStats', () => {
  it('counts activated invites (head count, no rows)', async () => {
    const calls: unknown[] = [];
    const chain = {
      select: (sel: string, opts: unknown) => { calls.push(['select', sel, opts]); return chain; },
      not: (col: string, op: string, v: unknown) => { calls.push(['not', col, op, v]); return Promise.resolve({ count: 3, error: null }); },
    };
    const client = { from: (t: string) => { calls.push(['from', t]); return chain; } } as unknown as AthanorClient;
    expect(await getInviteStats(client)).toEqual({ activated: 3 });
    expect(calls[0]).toEqual(['from', 'invites']);
  });
});
