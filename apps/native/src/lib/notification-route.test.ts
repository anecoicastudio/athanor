import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES, type Notification } from '@athanor/schemas';
import { routeForNotification } from './notification-route';

const notif = (patch: Partial<Notification>): Notification =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    recipient_id: '22222222-2222-4222-8222-222222222222',
    type: 'moment',
    template_key: 'notif.moment.body',
    params: {},
    entity_ref: null,
    read_at: null,
    created_at: '2026-06-17T12:00:00.000Z',
    ...patch,
  }) as Notification;

describe('routeForNotification', () => {
  it('moment → the match modal', () => {
    expect(routeForNotification(notif({ type: 'moment' }))).toBe('/(modal)/match');
  });

  it('review and dreamMilestone both land on your profile', () => {
    expect(routeForNotification(notif({ type: 'review' }))).toBe('/(tabs)/profile');
    expect(routeForNotification(notif({ type: 'dreamMilestone' }))).toBe('/(tabs)/profile');
  });

  it('fundMilestone → the annual fund modal', () => {
    expect(routeForNotification(notif({ type: 'fundMilestone' }))).toBe('/(modal)/annual');
  });

  it('projectResponse → the costellazioni tab', () => {
    expect(routeForNotification(notif({ type: 'projectResponse' }))).toBe('/(tabs)/costellazioni');
  });

  it('connection → the connections modal', () => {
    expect(routeForNotification(notif({ type: 'connection' }))).toBe('/(modal)/connections');
  });
});

describe('routeForNotification — eventReminder needs its entity_ref', () => {
  it('builds the event detail route from the ref id', () => {
    const n = notif({ type: 'eventReminder', entity_ref: { kind: 'event', id: 'ev-1' } });
    expect(routeForNotification(n)).toBe('/(modal)/event/ev-1');
  });

  it('a null entity_ref yields no destination rather than a broken route', () => {
    expect(routeForNotification(notif({ type: 'eventReminder', entity_ref: null }))).toBeNull();
  });

  it('an undefined entity_ref is equally safe', () => {
    const n = notif({ type: 'eventReminder', entity_ref: undefined });
    expect(routeForNotification(n)).toBeNull();
  });

  it('the ref kind is not consulted — only the id is', () => {
    const n = notif({ type: 'eventReminder', entity_ref: { kind: 'momento', id: 'ev-2' } });
    expect(routeForNotification(n)).toBe('/(modal)/event/ev-2');
  });
});

describe('routeForNotification — coverage of the canonical type set', () => {
  it('every one of the seven types resolves to a route', () => {
    for (const type of NOTIFICATION_TYPES) {
      const n = notif({ type, entity_ref: { kind: 'event', id: 'ev-1' } });
      expect(routeForNotification(n)).not.toBeNull();
    }
  });

  it('an unknown type is ignored rather than routed somewhere wrong', () => {
    expect(routeForNotification(notif({ type: 'somethingNew' as never }))).toBeNull();
  });
});
