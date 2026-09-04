import { describe, expect, it } from 'vitest';
import { INVITE_URL_BASE } from './links';
import { inviteShareMessage, inviteUrl } from './invite-share';

/**
 * #242 — the fund share card carries the P4.1 referral link, so an activation through it is
 * attributable by the machinery that already attributes invites. There is no new attribution
 * path here: the whole contract is "the shared text ends in a URL `app/invite/[code].tsx`
 * catches", and that is what this file pins.
 *
 * `.tsx` is uncollectable in this harness (`vitest.config.ts` collects `src/**\/*.test.ts`
 * only), so the seam has to be a `lib/` module for any of it to be pinned at all — the same
 * reason `lib/fund-cycle.ts` exists beside `annual.tsx`.
 */
describe('inviteUrl', () => {
  it('is the invite base plus the code, nothing else', () => {
    expect(inviteUrl('ABC123')).toBe(`${INVITE_URL_BASE}/ABC123`);
  });

  /*
   * The attribution pin. `app/invite/[code].tsx` reads `useLocalSearchParams().code` and hands
   * it to `setPendingReferral`, so the LAST path segment has to be the bare code and the prefix
   * has to be the `/invite` one `app.json`'s intent filters and associatedDomains claim. A
   * query string (`?ref=CODE`), a trailing slash, or a nested segment all break the catcher
   * silently — the link opens the browser, the code is never stashed, and the signup that
   * follows is attributed to nobody.
   */
  it('puts the code where the deep-link catcher reads it', () => {
    const url = new URL(inviteUrl('ZQ7K4M'));
    expect(url.pathname).toBe('/invite/ZQ7K4M');
    expect(url.search).toBe('');
    expect(url.pathname.split('/').at(-1)).toBe('ZQ7K4M');
  });
});

describe('inviteShareMessage', () => {
  /*
   * Byte-for-byte the expression this replaced, which was copy-pasted at three call sites
   * (InviteCard, PrimeStelleCard, settings) before #242 would have made it four. Written as a
   * literal rather than rebuilt from the parts: a helper that reproduces its own bug agrees
   * with itself, which is exactly what a dedupe has to be prevented from doing.
   */
  it('reproduces the inline message the three existing call sites built', () => {
    expect(inviteShareMessage({ lead: 'Lead', appName: 'Athanor', code: 'ABC123' })).toBe(
      'Lead — Athanor https://www.athanor.world/invite/ABC123',
    );
  });

  it('separates lead from app name with an em dash, not a hyphen', () => {
    const msg = inviteShareMessage({ lead: 'Lead', appName: 'Athanor', code: 'ABC123' });
    expect(msg).toContain(' — ');
    expect(msg).not.toContain(' - ');
  });

  it('puts exactly one space before the link', () => {
    const msg = inviteShareMessage({ lead: 'Lead', appName: 'Athanor', code: 'ABC123' });
    expect(msg).toBe(`Lead — Athanor ${inviteUrl('ABC123')}`);
    expect(msg).not.toContain('  ');
  });

  /*
   * The code query is session-gated and can still be in flight when the sheet opens (the share
   * fires anyway — settings.tsx says so at its call site). Dropping the link is the right
   * degradation: an unattributed share beats a blocked one. What must NOT happen is a message
   * that trails whitespace or ends in a bare `/invite/`, which reads as a broken link.
   */
  for (const code of [null, undefined, ''] as const) {
    it(`omits the link, and the space before it, when the code is ${JSON.stringify(code)}`, () => {
      const msg = inviteShareMessage({ lead: 'Lead', appName: 'Athanor', code });
      expect(msg).toBe('Lead — Athanor');
      expect(msg).not.toContain(INVITE_URL_BASE);
      expect(msg).toBe(msg.trimEnd());
    });
  }

  it('keeps the lead and the app name verbatim — it is copy, never rewritten here', () => {
    expect(
      inviteShareMessage({
        lead: '«1€ può cambiare la vita di qualcuno»',
        appName: 'Athanor',
        code: 'ABC123',
      }),
    ).toBe(`«1€ può cambiare la vita di qualcuno» — Athanor ${inviteUrl('ABC123')}`);
  });
});
