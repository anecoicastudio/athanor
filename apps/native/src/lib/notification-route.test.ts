import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES, type Notification } from '@athanor/schemas';
import { routeForNotification, routeForPushData } from './notification-route';

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
    updated_at: '2026-06-17T12:00:00.000Z',
    ...patch,
  }) as Notification;

describe('routeForNotification', () => {
  it('moment → the Momenti deck, which is where «Apri Momento» promises to go (#637)', () => {
    // It used to be '/(modal)/match', with no params: that screen defaults source='accepted',
    // renders the mutual-match headline over an empty name and drops its CTA to dismiss(). The
    // producer fires on a PROPOSAL insert, so there is no match to show yet.
    expect(routeForNotification(notif({ type: 'moment' }))).toBe('/(tabs)/momenti');
  });

  it('review lands on your profile', () => {
    expect(routeForNotification(notif({ type: 'review' }))).toBe('/(tabs)/profile');
  });

  it('projectResponse → the costellazioni tab', () => {
    expect(routeForNotification(notif({ type: 'projectResponse' }))).toBe('/(tabs)/costellazioni');
  });

  it('connection → the connections modal', () => {
    expect(routeForNotification(notif({ type: 'connection' }))).toBe('/(modal)/connections');
  });
});

describe('routeForNotification — dreamMilestone faces two ways (#637)', () => {
  it('a profile ref sends the HELPER to the dream owner', () => {
    const n = notif({ type: 'dreamMilestone', entity_ref: { kind: 'profile', id: 'p-1' } });
    expect(routeForNotification(n)).toBe('/(modal)/user/p-1');
  });

  it('the owner-directed offer still lands on your own profile', () => {
    // The offer's recipient IS the dream owner, and (tabs)/profile carries their dream, its
    // tappe and the incoming offers they accept from. Same type, opposite audience.
    const n = notif({ type: 'dreamMilestone', entity_ref: { kind: 'milestone_help', id: 'h-1' } });
    expect(routeForNotification(n)).toBe('/(tabs)/profile');
  });

  it('a row written before the producers were re-signed still lands somewhere', () => {
    expect(routeForNotification(notif({ type: 'dreamMilestone', entity_ref: null }))).toBe(
      '/(tabs)/profile',
    );
  });

  it('a profile ref with no id degrades rather than building /(modal)/user/undefined', () => {
    const n = notif({ type: 'dreamMilestone', entity_ref: { kind: 'profile', id: '' } });
    expect(routeForNotification(n)).toBe('/(tabs)/profile');
  });
});

describe('routeForNotification — message is transport-only', () => {
  // 'message' is pushed by public.on_message_push and never writes a notifications row, so it is
  // absent from NOTIFICATION_TYPES on purpose. Without this arm the commonest push of all fell
  // through `default` to null, and wiring the tap listener would still have left it dead.
  it('opens the conversation the push names', () => {
    expect(routeForNotification({ type: 'message', entity_ref: { kind: null, id: 'c-1' } })).toBe(
      '/(modal)/chat?conversationId=c-1',
    );
  });

  it('falls back to the thread list when the ref is lost', () => {
    expect(routeForNotification({ type: 'message', entity_ref: null })).toBe('/(modal)/messages');
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
  // The two deliberate nulls are named, not skipped by predicate: a THIRD type added without a
  // route arm falls through the switch's `default` and would join them silently otherwise.
  const NO_ROUTE = ['moderation', 'reportQueue'] as const;

  it('every type except the two deliberate nulls resolves to a route', () => {
    for (const type of NOTIFICATION_TYPES) {
      if ((NO_ROUTE as readonly string[]).includes(type)) continue; // asserted below
      const n = notif({ type, entity_ref: { kind: 'event', id: 'ev-1' } });
      expect(routeForNotification(n)).not.toBeNull();
    }
  });

  it('moderation stays put — the warn row is the outcome, not a doorway (#313)', () => {
    const n = notif({ type: 'moderation', entity_ref: { kind: 'report', id: 'r-1' } });
    expect(routeForNotification(n)).toBeNull();
  });

  it('reportQueue stays put — the queue is a web surface, absent from this app (#602)', () => {
    // …and it stays null even WITH a ref, because there is no screen to send it to. The day
    // #311 lands a native admin queue, this is the assertion that has to change first.
    const n = notif({ type: 'reportQueue', entity_ref: { kind: 'report', id: 'r-1' } });
    expect(routeForNotification(n)).toBeNull();
    expect(routeForNotification(notif({ type: 'reportQueue', entity_ref: null }))).toBeNull();
  });

  it('fundMilestone → the annual fund screen, ref or no ref (#127)', () => {
    const withRef = notif({ type: 'fundMilestone', entity_ref: { kind: 'fund', id: 'fe-1' } });
    expect(routeForNotification(withRef)).toBe('/(modal)/annual');
    // The contrast with eventReminder is the point: one cycle is open globally, so the screen
    // resolves it itself and a lost ref still lands somewhere useful.
    expect(routeForNotification(notif({ type: 'fundMilestone', entity_ref: null }))).toBe(
      '/(modal)/annual',
    );
  });

  it('gdprExport → the data-export modal, where the download button lives (#129)', () => {
    const n = notif({ type: 'gdprExport', entity_ref: { kind: 'gdprExport', id: 'j-1' } });
    expect(routeForNotification(n)).toBe('/(modal)/data-export');
  });

  it('an unknown type is ignored rather than routed somewhere wrong', () => {
    expect(routeForNotification(notif({ type: 'somethingNew' as never }))).toBeNull();
  });
});

describe('routeForPushData — the OS banner payload (#637 item 1)', () => {
  // The fan-out crosses the whole ref object JSON-stringified; enqueue_push crosses a bare id.
  // One router serves both surfaces only because this normalises the two spellings.
  it('unpacks the fan-out spelling, kind and all', () => {
    expect(
      routeForPushData({
        type: 'dreamMilestone',
        route: 'dream',
        entity_ref: JSON.stringify({ kind: 'profile', id: 'p-9' }),
      }),
    ).toBe('/(modal)/user/p-9');
  });

  it('accepts the bare-id spelling the message push uses', () => {
    expect(routeForPushData({ type: 'message', route: 'chat', entity_ref: 'conv-7' })).toBe(
      '/(modal)/chat?conversationId=conv-7',
    );
  });

  it("the fan-out's empty-ref default routes without a target rather than crashing", () => {
    // logic.ts sends '{}' when a producer passed no ref at all.
    expect(routeForPushData({ type: 'moment', route: 'momenti', entity_ref: '{}' })).toBe(
      '/(tabs)/momenti',
    );
    expect(
      routeForPushData({ type: 'eventReminder', route: 'event', entity_ref: '{}' }),
    ).toBeNull();
  });

  it('malformed JSON costs the route, not the tap', () => {
    expect(routeForPushData({ type: 'eventReminder', entity_ref: '{not json' })).toBeNull();
    expect(routeForPushData({ type: 'moment', entity_ref: '{not json' })).toBe('/(tabs)/momenti');
  });

  it('a payload with no usable type yields no destination', () => {
    // Remote input arriving through the OS: every shape below is something a malformed or
    // hostile push could carry, and none of them may throw inside a listener.
    expect(routeForPushData(undefined)).toBeNull();
    expect(routeForPushData(null)).toBeNull();
    expect(routeForPushData('moment')).toBeNull();
    expect(routeForPushData({})).toBeNull();
    expect(routeForPushData({ type: '' })).toBeNull();
    expect(routeForPushData({ type: 42 })).toBeNull();
    expect(routeForPushData({ type: 'moment', entity_ref: 42 })).toBe('/(tabs)/momenti');
  });
});
