import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@athanor/schemas';
import { routeForNotification } from './notification-route';

/**
 * The push route map and the in-app router are two lists of notification types, maintained apart,
 * and #637 is what that costs. `_shared/notif-templates.ts` has carried `message: 'chat'` since
 * the beginning; `notification-route.ts` had no `message` arm, so a tapped message push — the
 * commonest push this app sends — fell through the switch's `default` to null. Nothing was red.
 * Wiring the tap listener without noticing would have shipped a listener that did nothing for the
 * majority of taps.
 *
 * The drift is silent in both directions by construction. A missing arm returns null, which is
 * indistinguishable from the two types that return null ON PURPOSE; a stale arm routes a type
 * that can no longer arrive. So neither side can be trusted to notice, and this asserts the two
 * are the same set.
 *
 * Read as text, because the mirror cannot be imported: it is Deno source with `npm:` specifiers
 * and its own `deno.json`, outside the pnpm workspace — the same move
 * `packages/schemas/src/notification-templates.mirror.test.ts` makes against the TEMPLATES literal
 * in that very file. This file's own source is read the same way, because the arms of a `switch`
 * are not reflectable at runtime.
 */
const findUp = (...segments: string[]): string => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, ...segments);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no ${segments.join('/')} above this test`);
    dir = parent;
  }
};

const MIRROR = readFileSync(
  findUp('supabase', 'functions', '_shared', 'notif-templates.ts'),
  'utf8',
);
// `.href`, not the URL object: apps/native's tsconfig pulls in the DOM lib, whose URL is not
// structurally the one node:url declares (TS2345). The sibling mirror tests take the same step.
const ROUTER = readFileSync(
  fileURLToPath(new URL('./notification-route.ts', import.meta.url).href),
  'utf8',
);

/** The keys of the Deno `ROUTE` object literal, in source order. */
function pushRouteTypes(): string[] {
  const start = MIRROR.indexOf('const ROUTE');
  if (start === -1) throw new Error('notif-templates.ts declares no ROUTE map');
  const end = MIRROR.indexOf('\n};', start);
  if (end === -1) throw new Error('the ROUTE literal does not close at column 0');
  // Two-space indent, unquoted keys. A comment line cannot match, and neither can a nested key.
  return [...MIRROR.slice(start, end).matchAll(/^ {2}([A-Za-z]\w*):/gm)].map(
    ([, k]) => k as string,
  );
}

/** The `case '…':` labels of routeForNotification's switch. */
function routerTypes(): string[] {
  return [...ROUTER.matchAll(/^\s{4}case '([^']+)':/gm)].map(([, k]) => k as string);
}

/** The two types whose destination is deliberately nowhere — named, never inferred. */
const NO_ROUTE = ['moderation', 'reportQueue'] as const;

describe('the push route map and the in-app router are one set', () => {
  const pushed = pushRouteTypes();
  const routed = routerTypes();

  it('parses both sides at all', () => {
    // Without this, a rename or a reformat that broke either regex would empty a list and read
    // exactly like two lists in perfect agreement — the failure this file exists to make loud.
    expect(pushed.length, 'no keys parsed out of the ROUTE literal').toBeGreaterThan(8);
    expect(routed.length, 'no case labels parsed out of routeForNotification').toBeGreaterThan(8);
  });

  it('the router has an arm for every type a push can carry', () => {
    expect(
      pushed.filter((t) => !routed.includes(t)),
      'a type the push map routes has no arm in notification-route.ts. Its `default` returns ' +
        'null, so a member tapping that banner opens the app wherever it last was — silently.',
    ).toEqual([]);
  });

  it('the router routes nothing the push map cannot send', () => {
    expect(
      routed.filter((t) => !pushed.includes(t)),
      'notification-route.ts has an arm for a type absent from the push ROUTE map. Either the ' +
        'map is behind, or the arm is dead — buildPushMessages falls back to `momenti` for an ' +
        'unlisted type, so the banner would land somewhere unrelated.',
    ).toEqual([]);
  });

  it('every routable pushed type actually resolves, and the two nulls are the named ones', () => {
    // Coverage is not enough on its own: an arm can exist and still return null. A ref is supplied
    // so the ref-dependent arms (eventReminder, message) are exercised on their happy path.
    for (const type of pushed) {
      const href = routeForNotification({ type, entity_ref: { kind: 'event', id: 'x-1' } });
      if ((NO_ROUTE as readonly string[]).includes(type)) {
        expect(href, `${type} is meant to stay put`).toBeNull();
      } else {
        expect(href, `${type} routes nowhere`).not.toBeNull();
      }
    }
  });

  it('the push map is a strict superset of the DB type enum, and `message` is the difference', () => {
    // The one deliberate asymmetry, pinned so it stays deliberate: public.on_message_push is pure
    // transport — it writes no notifications row — so 'message' is absent from the type CHECK and
    // present on the wire. If a second type ever joins it, that is a decision, not a drift.
    expect(NOTIFICATION_TYPES.filter((t) => !pushed.includes(t))).toEqual([]);
    expect(pushed.filter((t) => !(NOTIFICATION_TYPES as readonly string[]).includes(t))).toEqual([
      'message',
    ]);
  });
});
