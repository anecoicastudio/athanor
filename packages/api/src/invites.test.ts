import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
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
      rpc: (fn: string) =>
        Promise.resolve({ data: fn === 'ensure_referral_code' ? 'A1B2C3D4' : null, error: null }),
    } as unknown as AthanorClient;
    expect(await getMyReferralCode(client)).toBe('A1B2C3D4');
  });
});

describe('getInviteStats', () => {
  it('counts activated invites sent by the given inviter (head count, no rows)', async () => {
    const calls: unknown[] = [];
    const chain = {
      select: (sel: string, opts: unknown) => {
        calls.push(['select', sel, opts]);
        return chain;
      },
      eq: (col: string, v: unknown) => {
        calls.push(['eq', col, v]);
        return chain;
      },
      not: (col: string, op: string, v: unknown) => {
        calls.push(['not', col, op, v]);
        return Promise.resolve({ count: 3, error: null });
      },
    };
    const client = {
      from: (t: string) => {
        calls.push(['from', t]);
        return chain;
      },
    } as unknown as AthanorClient;
    expect(await getInviteStats(client, 'profile-1')).toEqual({ activated: 3 });
    expect(calls[0]).toEqual(['from', 'invites']);
    expect(calls).toContainEqual(['eq', 'inviter_id', 'profile-1']);
  });
});

// `count ?? 0` is the one genuinely reachable coalesce in this package: PostgREST returns a null
// count when the content-range header is absent on a `{ count: 'exact', head: true }` query.
describe('getInviteStats', () => {
  it('reads a null count as zero activations rather than crashing', async () => {
    const fake = makeFakeClient({ 'invites.select': [{ data: null, count: null }] });
    await expect(getInviteStats(asClient(fake), 'u1')).resolves.toEqual({ activated: 0 });
  });

  it('rethrows instead of reporting zero activations', async () => {
    const fake = makeFakeClient({ 'invites.select': [{ error: DB_DOWN }] });
    await expect(getInviteStats(asClient(fake), 'u1')).rejects.toMatchObject({ code: '57P01' });
  });
});

describe('getMyReferralCode', () => {
  it('rethrows rather than handing back an empty invite link', async () => {
    const fake = makeFakeClient({ 'rpc.ensure_referral_code': [{ error: DB_DOWN }] });
    await expect(getMyReferralCode(asClient(fake))).rejects.toMatchObject({ code: '57P01' });
  });
});
