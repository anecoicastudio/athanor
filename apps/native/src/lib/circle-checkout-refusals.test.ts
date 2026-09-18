import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Circle checkout ladder (`create-circle-checkout/logic.ts`) and the screen that renders its
 * refusals (`(modal)/circle.tsx`) never import each other: the server's `{error}` string is the
 * whole contract, carried across by `CircleCheckoutError.code`. #701 is what an unpinned pair
 * costs — a new ticket refusal shipped server-side and fell through to a sentence about a
 * payment that was never attempted. This pins the Circle pair the same way.
 *
 * The rule: every 4xx the ladder can return is a SPECIFIC refusal and owes its own arm on the
 * screen, keyed on the exact code. The one exemption is named below with its reason, so adding
 * a guard means either mapping it or arguing for it here. The 500s get nothing: they are
 * undifferentiated faults and share `circle.error.title`.
 *
 * Read as text — the source-audit idiom this app uses for UI guarantees (`environment: 'node'`).
 * `apps/native/turbo.json` declares the ladder as a `$TURBO_ROOT$` input, or turbo would replay a
 * cached PASS across exactly the server-side drift this file exists to catch.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url).href);
const LADDER = readFileSync(
  `${SRC}../../../supabase/functions/create-circle-checkout/logic.ts`,
  'utf8',
);
const SCREEN = readFileSync(`${SRC}app/(modal)/circle.tsx`, 'utf8');

/** `error('some message', 409)` → the message, for 4xx only. */
const clientRefusals = [
  ...new Set(
    [...LADDER.matchAll(/(?:^|[^.\w])error\(\s*'([^']+)'\s*,\s*4\d{2}\s*\)/g)]
      .map((m) => m[1])
      .filter((v): v is string => v !== undefined),
  ),
];

/**
 * Refusals the app can never provoke, so no copy is owed. `plan must be monthly or annual`: the
 * screen sends only `PriceToggle`'s two literals, so this 400 is a client bug, not a state.
 */
const UNREACHABLE_FROM_THE_APP = new Set(['plan must be monthly or annual']);

describe('every Circle checkout refusal has its own arm (#759)', () => {
  it('finds the refusals — a regex that matched nothing would make this file decorative', () => {
    // Anchors: the two refusals that exist today must both be seen.
    expect(clientRefusals).toContain('circle checkout closed');
    expect(clientRefusals).toContain('circle already subscribed');
    // Every error() in the ladder is a single-quoted literal with a numeric status, so a guard
    // written any other way turns this red instead of slipping past the extraction.
    const calls = LADDER.match(/(?:^|[^.\w])error\(/g) ?? [];
    const literal = LADDER.match(/(?:^|[^.\w])error\(\s*'[^']+'\s*,\s*\d{3}\s*\)/g) ?? [];
    expect(literal.length).toBe(calls.length);
  });

  it('maps each 4xx to a branch keyed on its exact code', () => {
    for (const code of clientRefusals) {
      if (UNREACHABLE_FROM_THE_APP.has(code)) continue;
      expect(SCREEN, code).toContain(`e instanceof CircleCheckoutError && e.code === '${code}'`);
    }
  });

  it('the exemption list names only refusals that still exist', () => {
    for (const code of UNREACHABLE_FROM_THE_APP) expect(clientRefusals).toContain(code);
  });

  it('a live subscription leads to the portal, never to the generic error', () => {
    // The refusal arm sets its own state, and that state renders the refusal line and the
    // portal action — not `checkoutError`, which is «Qualcosa non ha funzionato».
    const branch = SCREEN.slice(
      SCREEN.indexOf("e.code === 'circle already subscribed'"),
      SCREEN.indexOf('} else {', SCREEN.indexOf("e.code === 'circle already subscribed'")),
    );
    expect(branch).toContain('setAlreadySubscribed(true)');
    expect(branch).not.toContain('setCheckoutError');
    // The cache may just be behind a webhook in flight: re-read it, so the member state takes over.
    expect(branch).toContain('entitlementKeys.me()');

    const arm = SCREEN.slice(
      SCREEN.indexOf(') : alreadySubscribed ? ('),
      SCREEN.indexOf(") : checkoutGate === 'loading' ? ("),
    );
    expect(arm).toContain("t('circle.alreadySubscribed', locale)");
    expect(arm).toContain('onPress={() => void onManage()}');
    expect(arm).toContain("t('circle.portal.error', locale)");
  });

  it('the refusal arm sits after iOS and before the Join button', () => {
    // After iOS: the portal is Apple 3.1.1's surface too, and iOS never offers Join anyway.
    // Before the CTA: a member Stripe says is subscribed must not be offered a second checkout.
    const ios = SCREEN.indexOf("t('circle.iosUnavailable', locale)");
    const arm = SCREEN.indexOf(') : alreadySubscribed ? (');
    const cta = SCREEN.indexOf("'circle.cta.monthly'");
    expect(ios).toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(ios);
    expect(cta).toBeGreaterThan(arm);
  });
});
