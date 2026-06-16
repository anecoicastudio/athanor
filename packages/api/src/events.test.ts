import { describe, expect, it } from 'vitest';
import { eventKeys, subscribeEventLive, subscribeTicket } from './events';

describe('eventKeys', () => {
  it('namespaces rsvp + attendees distinctly under the events root', () => {
    expect(eventKeys.all).toEqual(['events']);
    expect(eventKeys.detail('e1')).toEqual(['events', 'detail', 'e1']);
    expect(eventKeys.rsvp('e1')).toEqual(['events', 'rsvp', 'e1']);
    expect(eventKeys.attendees('e1')).toEqual(['events', 'attendees', 'e1']);
  });
});

describe('eventKeys.liveStats', () => {
  it('namespaces live stats distinctly under the events root', () => {
    expect(eventKeys.liveStats('e1')).toEqual(['events', 'liveStats', 'e1']);
  });
});

describe('subscribeEventLive', () => {
  it('returns a cleanup fn and removes the channel when called (rule api.md)', () => {
    let removed: unknown = null;
    const channel = { on: () => channel, subscribe: () => channel };
    const fakeClient = {
      channel: () => channel,
      removeChannel: (c: unknown) => {
        removed = c;
      },
    } as unknown as Parameters<typeof subscribeEventLive>[0];

    const cleanup = subscribeEventLive(fakeClient, 'e1', () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(removed).toBe(channel);
  });
});

describe('eventKeys.ticket', () => {
  it('namespaces a ticket under the events root', () => {
    expect(eventKeys.ticket('e1')).toEqual(['events', 'ticket', 'e1']);
  });
});

describe('subscribeTicket', () => {
  it('returns a cleanup fn that removes the channel (rule api.md)', () => {
    let removed: unknown = null;
    const channel = { on: () => channel, subscribe: () => channel };
    const fakeClient = {
      channel: () => channel,
      removeChannel: (c: unknown) => {
        removed = c;
      },
    } as unknown as Parameters<typeof subscribeTicket>[0];

    const cleanup = subscribeTicket(fakeClient, 'e1', 'u1', () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(removed).toBe(channel);
  });
});
