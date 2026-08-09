import { describe, expect, it, vi } from 'vitest';
import { pushTokenKeys, registerPushToken, unregisterPushToken } from './pushTokens';
import type { AthanorClient } from './client';

function mockClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const from = vi.fn().mockReturnValue({ upsert, delete: del });
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'me-uuid' } } }) };
  return { client: { from, auth } as unknown as AthanorClient, from, upsert, del };
}

describe('pushTokenKeys', () => {
  it('exposes a stable mine() key', () => {
    expect(pushTokenKeys.mine()).toEqual(['push_tokens', 'mine']);
  });
});

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
      { profile_id: 'me-uuid', token: 'ExponentPushToken[a]', platform: 'ios', device_id: 'd1' },
      { onConflict: 'profile_id,token' },
    );
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
