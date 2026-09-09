import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import {
  PayoutOnboardingError,
  getMyPayoutAccount,
  payoutKeys,
  requestPayoutOnboarding,
} from './payouts';

const ME = '00000000-0000-0000-0000-000000000001';

type Call = { method: string; arg: unknown };

/** Per-table thenable builder stub — the verifications.test.ts shape, one table deep. */
function clientWith(
  result: { data: unknown; error: unknown },
  user: { id: string } | null = { id: ME },
  userErr: unknown = null,
) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) {
    chain[m] = (arg?: unknown) => {
      calls.push({ method: `payout_accounts.${m}`, arg });
      return chain;
    };
  }
  chain['maybeSingle'] = () => {
    calls.push({ method: 'payout_accounts.maybeSingle', arg: undefined });
    return Promise.resolve(result);
  };
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: userErr }) },
    from: (table: string) => {
      calls.push({ method: `from.${table}`, arg: undefined });
      return chain;
    },
  } as unknown as AthanorClient;
  return { client, calls };
}

const row = (over: Record<string, unknown> = {}) => ({
  charges_enabled: false,
  payouts_enabled: true,
  onboarded_at: '2026-09-01T10:00:00Z',
  ...over,
});

describe('payoutKeys', () => {
  it('mine factory shape', () => {
    expect(payoutKeys.all).toEqual(['payout']);
    expect(payoutKeys.mine()).toEqual(['payout', 'mine']);
  });
});

describe('getMyPayoutAccount', () => {
  it('throws "not authenticated" when there is no user and no auth error', async () => {
    const { client } = clientWith({ data: null, error: null }, null);
    await expect(getMyPayoutAccount(client)).rejects.toThrow('not authenticated');
  });

  it('throws the auth error itself when getUser errors', async () => {
    const boom = new Error('auth down');
    const { client } = clientWith({ data: null, error: null }, null, boom);
    await expect(getMyPayoutAccount(client)).rejects.toBe(boom);
  });

  it('throws the query error rather than reporting "not enabled"', async () => {
    // Fail loud. A read error absorbed into `payoutsEnabled: false` would show an onboarded
    // organiser a Connect-your-account CTA they have already completed, and hide the real fault.
    const boom = { message: 'permission denied' };
    const { client } = clientWith({ data: null, error: boom });
    await expect(getMyPayoutAccount(client)).rejects.toBe(boom);
  });

  it('reads no row as "never started", not as an error', async () => {
    // An organiser who has never opened onboarding simply has no row — that is the state the
    // composer's CTA exists for, so it must not throw and must not look like a disabled account.
    const { client } = clientWith({ data: null, error: null });
    await expect(getMyPayoutAccount(client)).resolves.toEqual({
      hasAccount: false,
      payoutsEnabled: false,
      onboardedAt: null,
    });
  });

  it('reports an enabled account', async () => {
    const { client } = clientWith({ data: row(), error: null });
    await expect(getMyPayoutAccount(client)).resolves.toEqual({
      hasAccount: true,
      payoutsEnabled: true,
      onboardedAt: '2026-09-01T10:00:00Z',
    });
  });

  it('distinguishes "started but not enabled" from "never started"', async () => {
    // The two render differently: one says Stripe is still reviewing, the other offers the flow.
    // Collapsing them would send an organiser mid-review back through onboarding they finished.
    const { client } = clientWith({
      data: row({ payouts_enabled: false, onboarded_at: null }),
      error: null,
    });
    await expect(getMyPayoutAccount(client)).resolves.toEqual({
      hasAccount: true,
      payoutsEnabled: false,
      onboardedAt: null,
    });
  });

  it('parses the row rather than casting it — a missing flag throws', async () => {
    // rules/api.md: a cast asserts a shape nothing checked. This flag decides whether a paid event
    // may be published, so a drifted shape must fail loudly here instead of reading as "not yet
    // enabled" and silently locking every organiser out of the paid path.
    const { client } = clientWith({
      data: { charges_enabled: false, onboarded_at: null },
      error: null,
    });
    await expect(getMyPayoutAccount(client)).rejects.toThrow();
  });

  it('asks only for the caller’s own row, and only for the three fields it uses', async () => {
    // stripe_account_id is deliberately not selected: the app never needs it, and it has no reason
    // to sit in a query cache. The eq() proves the read is scoped to the caller.
    const { client, calls } = clientWith({ data: row(), error: null });
    await getMyPayoutAccount(client);
    const select = calls.find((c) => c.method === 'payout_accounts.select');
    expect(select?.arg).toBe('charges_enabled,payouts_enabled,onboarded_at');
    expect(String(select?.arg)).not.toContain('stripe_account_id');
    expect(calls.find((c) => c.method === 'payout_accounts.eq')?.arg).toBe('profile_id');
  });
});

/** Minimal functions.invoke stub — the FunctionsHttpError shape the #416 idiom reads. */
function invokeClient(res: { data?: unknown; error?: unknown }) {
  return {
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null, ...res }) },
  } as unknown as AthanorClient;
}

const httpError = (status: number, body: unknown) => ({
  context: { status, json: () => Promise.resolve(body) },
});

describe('requestPayoutOnboarding', () => {
  it('returns the hosted onboarding url', async () => {
    const client = invokeClient({ data: { url: 'https://connect.stripe.test/setup/x' } });
    await expect(requestPayoutOnboarding(client)).resolves.toEqual({
      url: 'https://connect.stripe.test/setup/x',
    });
  });

  it('carries the server’s reason as a typed error, so the screen can say which failure', async () => {
    const client = invokeClient({ error: httpError(403, { error: 'identity not verified' }) });
    const err = await requestPayoutOnboarding(client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayoutOnboardingError);
    expect((err as PayoutOnboardingError).code).toBe('identity not verified');
    expect((err as PayoutOnboardingError).status).toBe(403);
  });

  it('carries the not-configured refusal too, which is a deploy fault and not the member’s', async () => {
    // create-payout-onboarding returns this when PAYOUT_ONBOARDING_RETURN_URL / _REFRESH_URL are
    // unset. Since #104 that blocks every paid event, so the code must survive to the screen.
    const client = invokeClient({
      error: httpError(500, { error: 'payout onboarding not configured' }),
    });
    const err = await requestPayoutOnboarding(client).catch((e: unknown) => e);
    expect((err as PayoutOnboardingError).code).toBe('payout onboarding not configured');
  });

  it('rethrows the raw error when the body cannot be read', async () => {
    const raw = Object.assign(new Error('relay down'), {
      context: {
        status: 502,
        json: () => Promise.reject(new Error('not json')),
      },
    });
    const client = invokeClient({ error: raw });
    await expect(requestPayoutOnboarding(client)).rejects.toBe(raw);
  });

  it('rethrows the raw error when there is no context at all', async () => {
    const raw = new Error('network');
    const client = invokeClient({ error: raw });
    await expect(requestPayoutOnboarding(client)).rejects.toBe(raw);
  });

  it('refuses a 200 that carries no url, rather than opening "undefined"', async () => {
    await expect(requestPayoutOnboarding(invokeClient({ data: {} }))).rejects.toThrow(
      'no onboarding url returned',
    );
    await expect(requestPayoutOnboarding(invokeClient({ data: null }))).rejects.toThrow(
      'no onboarding url returned',
    );
    await expect(requestPayoutOnboarding(invokeClient({ data: { url: 42 } }))).rejects.toThrow(
      'no onboarding url returned',
    );
  });
});
