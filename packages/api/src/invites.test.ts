import { describe, expect, it } from 'vitest';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';
import { getMyReferralCode, inviteKeys, redeemPendingReferral } from './invites';

describe('inviteKeys', () => {
  it('namespaces under invites', () => {
    expect(inviteKeys.all).toEqual(['invites']);
    expect(inviteKeys.code()).toEqual(['invites', 'code']);
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

describe('getMyReferralCode', () => {
  it('rethrows rather than handing back an empty invite link', async () => {
    const fake = makeFakeClient({ 'rpc.ensure_referral_code': [{ error: DB_DOWN }] });
    await expect(getMyReferralCode(asClient(fake))).rejects.toMatchObject({ code: '57P01' });
  });
});

describe('redeemPendingReferral', () => {
  it('passes the code to the RPC under the parameter the function declares', async () => {
    const fake = makeFakeClient();
    await redeemPendingReferral(asClient(fake), 'FRIEND22');
    expect(fake.calls).toEqual([
      expect.objectContaining({
        table: 'rpc',
        op: 'rpc',
        columns: 'redeem_pending_referral',
        values: { p_code: 'FRIEND22' },
      }),
    ]);
  });

  it('rethrows, so the caller keeps the stash for the next boot instead of dropping it', async () => {
    const fake = makeFakeClient({ 'rpc.redeem_pending_referral': [{ error: DB_DOWN }] });
    await expect(redeemPendingReferral(asClient(fake), 'FRIEND22')).rejects.toMatchObject({
      code: '57P01',
    });
  });
});
