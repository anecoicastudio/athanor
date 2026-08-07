import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import { gdprKeys, getConsents, setConsent, setLocationConsent } from './consent';

const ME = '00000000-0000-0000-0000-000000000001';

/** A consent row as PostgREST returns it — must pass consentSchema.parse. */
const CONSENT_ROW = {
  id: '00000000-0000-0000-0000-0000000000a1',
  profile_id: ME,
  kind: 'analytics' as const,
  granted: true,
  granted_at: '2026-01-02T00:00:00Z',
  source: 'settings' as const,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

/** Thenable select stub: from('consent').select(...) resolves { data, error }. */
function selectStub(data: unknown, error: unknown = null) {
  const calls: Array<{ method: string; arg: unknown }> = [];
  const chain = {
    select: (arg?: unknown) => {
      calls.push({ method: 'select', arg });
      return Promise.resolve({ data, error });
    },
  };
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

/** Authed upsert stub: records upsert(values, options); resolves { error }. */
function upsertStub(user: { id: string } | null = { id: ME }, error: unknown = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockReturnValue({ upsert }),
  } as unknown as AthanorClient;
  return { client, upsert };
}

describe('gdprKeys', () => {
  it('scopes the consent key by profile id (persisted-cache leak guard)', () => {
    expect(gdprKeys.all).toEqual(['gdpr']);
    expect(gdprKeys.consent(ME)).toEqual(['gdpr', 'consent', ME]);
    expect(gdprKeys.exportStatus()).toEqual(['gdpr', 'export']);
    expect(gdprKeys.erasure()).toEqual(['gdpr', 'erasure']);
  });
});

describe('getConsents', () => {
  it('parses rows through consentSchema', async () => {
    const { client } = selectStub([CONSENT_ROW]);
    await expect(getConsents(client)).resolves.toEqual([CONSENT_ROW]);
  });

  it('returns [] when data is null', async () => {
    const { client } = selectStub(null);
    await expect(getConsents(client)).resolves.toEqual([]);
  });

  it('throws on error', async () => {
    const { client } = selectStub(null, new Error('boom'));
    await expect(getConsents(client)).rejects.toThrow('boom');
  });
});

describe('setConsent', () => {
  it('throws "not authenticated" when there is no user', async () => {
    const { client, upsert } = upsertStub(null);
    await expect(
      setConsent(client, { kind: 'analytics', granted: true, source: 'settings' }),
    ).rejects.toThrow('not authenticated');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts the session profile_id + input with a fresh ISO granted_at, onConflict (profile_id,kind)', async () => {
    const { client, upsert } = upsertStub();
    await setConsent(client, { kind: 'comms', granted: false, source: 'signup' });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [values, options] = upsert.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(values).toEqual({
      profile_id: ME,
      kind: 'comms',
      granted: false,
      source: 'signup',
      granted_at: expect.any(String),
    });
    // granted_at is a real ISO timestamp of "now"
    expect(new Date(values['granted_at'] as string).toISOString()).toBe(values['granted_at']);
    expect(options).toEqual({ onConflict: 'profile_id,kind' });
  });

  it('throws on upsert error', async () => {
    const { client } = upsertStub({ id: ME }, new Error('rls denied'));
    await expect(
      setConsent(client, { kind: 'analytics', granted: true, source: 'settings' }),
    ).rejects.toThrow('rls denied');
  });
});

describe('setLocationConsent', () => {
  it('delegates to setConsent with kind=location_approx and source=settings', async () => {
    const { client, upsert } = upsertStub();
    await setLocationConsent(client, true);
    const [values] = upsert.mock.calls[0] as [Record<string, unknown>];
    expect(values['kind']).toBe('location_approx');
    expect(values['source']).toBe('settings');
    expect(values['granted']).toBe(true);
  });
});
