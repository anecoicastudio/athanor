import { describe, it, expect } from 'vitest';
import { notifKeys } from './notifications';

describe('notifKeys', () => {
  it('namespaces all keys under "notifications"', () => {
    expect(notifKeys.all).toEqual(['notifications']);
    expect(notifKeys.list()).toEqual(['notifications', 'list', 'head']);
    expect(notifKeys.list('cur')).toEqual(['notifications', 'list', 'cur']);
    expect(notifKeys.unreadPresence()).toEqual(['notifications', 'unread']);
    expect(notifKeys.prefs()).toEqual(['notifications', 'prefs']);
  });
});
