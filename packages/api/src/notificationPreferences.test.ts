import { describe, it, expect, vi } from 'vitest';
import { setNotifPref } from './notificationPreferences';

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
