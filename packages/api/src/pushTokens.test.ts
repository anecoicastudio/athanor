import { describe, expect, it, vi } from 'vitest';
import { registerPushToken, unregisterPushToken } from './pushTokens';
import type { AthanorClient } from './client';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';

const ME = '00000000-0000-4000-8000-000000000001';

function mockClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const from = vi.fn().mockReturnValue({ upsert, delete: del });
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: ME } } }) };
  return { client: { from, auth } as unknown as AthanorClient, from, upsert, del };
}

describe('registerPushToken', () => {
  it('upserts on the (profile_id, token) conflict target with the session profile_id', async () => {
    const { client, from, upsert } = mockClient();
    await registerPushToken(client, {
      token: 'ExponentPushToken[a]',
      platform: 'ios',
      deviceId: 'd1',
    });
    expect(from).toHaveBeenCalledWith('push_tokens');
    expect(upsert).toHaveBeenCalledWith(
      { profile_id: ME, token: 'ExponentPushToken[a]', platform: 'ios', device_id: 'd1' },
      { onConflict: 'profile_id,token' },
    );
  });

  // The parse is the write boundary (#274): an out-of-contract payload throws before any
  // network call, instead of surfacing later as an opaque CHECK-constraint violation.
  it('rejects a token over the 512-char CHECK bound before writing anything', async () => {
    const { client, upsert } = mockClient();
    await expect(
      registerPushToken(client, { token: 'x'.repeat(513), platform: 'ios' }),
    ).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('unregisterPushToken', () => {
  it('deletes the row by token', async () => {
    const { client, from, del } = mockClient();
    await unregisterPushToken(client, 'ExponentPushToken[a]');
    expect(from).toHaveBeenCalledWith('push_tokens');
    expect(del).toHaveBeenCalled();
  });
});

// `registerPushToken` returns silently when there is no session. That branch was unasserted, and
// a silent return is invisible by construction: the device simply never receives a Momento and
// nothing anywhere reports why. Pin both that it does not throw AND that it writes nothing.
describe('registerPushToken — the no-session branch', () => {
  it('is a no-op, not a write, when there is no session', async () => {
    const fake = makeFakeClient({ 'auth.getUser': [{ data: { user: null }, error: null }] });
    await expect(
      registerPushToken(asClient(fake) as never, {
        token: 'ExponentPushToken[x]',
        platform: 'ios',
      }),
    ).resolves.toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it('rethrows an upsert failure rather than reporting the device registered', async () => {
    const fake = makeFakeClient({
      'auth.getUser': [{ data: { user: { id: ME } }, error: null }],
      'push_tokens.upsert': [{ error: DB_DOWN }],
    });
    await expect(
      registerPushToken(asClient(fake) as never, {
        token: 'ExponentPushToken[x]',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: '57P01' });
  });
});

describe('unregisterPushToken', () => {
  it('rethrows rather than reporting a silent success on logout', async () => {
    const fake = makeFakeClient({ 'push_tokens.delete': [{ error: DB_DOWN }] });
    await expect(
      unregisterPushToken(asClient(fake) as never, 'ExponentPushToken[x]'),
    ).rejects.toMatchObject({ code: '57P01' });
  });
});
