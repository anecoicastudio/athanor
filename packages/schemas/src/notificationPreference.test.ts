import { describe, it, expect } from 'vitest';
import { notifPrefInput } from './notificationPreference.ts';

describe('notifPrefInput', () => {
  it('parses a valid pref input', () => {
    const v = notifPrefInput.parse({ type: 'moment', channel: 'push', enabled: false });
    expect(v.enabled).toBe(false);
  });
  it('rejects an unknown channel', () => {
    expect(() => notifPrefInput.parse({ type: 'moment', channel: 'sms', enabled: true })).toThrow();
  });
  it('rejects an unknown type', () => {
    expect(() => notifPrefInput.parse({ type: 'nope', channel: 'push', enabled: true })).toThrow();
  });
});
