import { describe, it, expect, vi } from 'vitest';
import { getPreferences, getPushEnabled, setNotifPref } from './notificationPreferences';
import { asClient, DB_DOWN, makeFakeClient } from './test-support/fake-client';

describe('setNotifPref', () => {
  it('upserts on the (profile_id,type,channel) conflict target', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: () => ({ upsert }),
    } as never;
    await setNotifPref(client, { type: 'moment', channel: 'push', enabled: false });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'u1',
        type: 'moment',
        channel: 'push',
        enabled: false,
      }),
      expect.objectContaining({ onConflict: 'profile_id,type,channel' }),
    );
  });
});

// The master push toggle is DEFAULT-ON when absent, and both of its branches were unasserted:
// the no-session arm and the `?? true` arm off a `.maybeSingle()` that legitimately returns
// null for a profile with no row yet. Getting either inverted mutes everyone or spams everyone,
// and no test would have said so.
describe('getPushEnabled — the default-on contract', () => {
  it('defaults to on when the profile row has no value yet', async () => {
    const fake = makeFakeClient({ 'rpc.get_own_profile': [{ data: null }] });
    await expect(getPushEnabled(asClient(fake))).resolves.toBe(true);
  });

  it('defaults to on when there is no session at all', async () => {
    const fake = makeFakeClient({ 'auth.getUser': [{ data: { user: null }, error: null }] });
    await expect(getPushEnabled(asClient(fake))).resolves.toBe(true);
  });

  it('honours an explicit false', async () => {
    const fake = makeFakeClient({ 'rpc.get_own_profile': [{ data: { push_enabled: false } }] });
    await expect(getPushEnabled(asClient(fake))).resolves.toBe(false);
  });

  // Not the same as "off": a failed read must not silently mute someone.
  it('rethrows rather than reporting a preference it could not read', async () => {
    const fake = makeFakeClient({ 'rpc.get_own_profile': [{ error: DB_DOWN }] });
    await expect(getPushEnabled(asClient(fake))).rejects.toMatchObject({ code: '57P01' });
  });
});

describe('getPreferences', () => {
  it('holds its empty-payload guard', async () => {
    const fake = makeFakeClient({ 'notification_preferences.select': [{ data: null }] });
    await expect(getPreferences(asClient(fake))).resolves.toEqual([]);
  });

  it('rethrows instead of reporting no preferences', async () => {
    const fake = makeFakeClient({ 'notification_preferences.select': [{ error: DB_DOWN }] });
    await expect(getPreferences(asClient(fake))).rejects.toMatchObject({ code: '57P01' });
  });
});
