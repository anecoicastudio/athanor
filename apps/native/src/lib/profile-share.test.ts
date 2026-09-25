import { describe, expect, it } from 'vitest';
import { profileShareMessage } from './profile-share';
import { SITE_ORIGIN } from './links';

describe('profileShareMessage', () => {
  it('carries the @handle, the app name and the /@handle URL when the page exists', () => {
    expect(profileShareMessage('gio_musica', 'Athanor', true)).toBe(
      `@gio_musica — Athanor\n${SITE_ORIGIN}/@gio_musica`,
    );
  });

  // Asserted as a literal on both sides rather than by comparing the two calls to each
  // other: an equality check between two calls of the function under test passes
  // vacuously if a regression makes both return null.
  it('does not double the @ when the handle already carries one', () => {
    expect(profileShareMessage('@gio_musica', 'Athanor', true)).toBe(
      `@gio_musica — Athanor\n${SITE_ORIGIN}/@gio_musica`,
    );
    expect(profileShareMessage('gio_musica', 'Athanor', true)).toBe(
      `@gio_musica — Athanor\n${SITE_ORIGIN}/@gio_musica`,
    );
  });

  // #790: «Membri» is the default, so most new members have no page. A link that 404s is
  // worse than none — the message keeps the handle and the app name and drops the URL.
  it('drops the URL when the member has no public page', () => {
    expect(profileShareMessage('gio_musica', 'Athanor', false)).toBe('@gio_musica — Athanor');
    expect(profileShareMessage('gio_musica', 'Athanor', false)).not.toContain(SITE_ORIGIN);
  });

  it('returns null when there is no handle, so no share control renders', () => {
    expect(profileShareMessage('', 'Athanor', true)).toBeNull();
    expect(profileShareMessage('   ', 'Athanor', true)).toBeNull();
    expect(profileShareMessage('@', 'Athanor', true)).toBeNull();
    expect(profileShareMessage(null, 'Athanor', true)).toBeNull();
    expect(profileShareMessage(undefined, 'Athanor', true)).toBeNull();
  });

  // The URL must derive from SITE_ORIGIN (links.ts anchors that host to app.json's
  // associated domain) — a fresh literal here would escape that check.
  it('builds the URL from SITE_ORIGIN, on the /@handle route', () => {
    const msg = profileShareMessage('gio_musica', 'Athanor', true);
    expect(msg).toContain(`${SITE_ORIGIN}/@gio_musica`);
    expect(msg?.match(/https?:\/\//g)).toHaveLength(1);
  });
});
