import { describe, expect, it } from 'vitest';
import { profileShareMessage } from './profile-share';

describe('profileShareMessage', () => {
  it('carries the @handle and the app name', () => {
    expect(profileShareMessage('gio_musica', 'Athanor')).toBe('@gio_musica — Athanor');
  });

  // Asserted as a literal on both sides rather than by comparing the two calls to each
  // other: an equality check between two calls of the function under test passes
  // vacuously if a regression makes both return null.
  it('does not double the @ when the handle already carries one', () => {
    expect(profileShareMessage('@gio_musica', 'Athanor')).toBe('@gio_musica — Athanor');
    expect(profileShareMessage('gio_musica', 'Athanor')).toBe('@gio_musica — Athanor');
  });

  it('returns null when there is no handle, so no share control renders', () => {
    expect(profileShareMessage('', 'Athanor')).toBeNull();
    expect(profileShareMessage('   ', 'Athanor')).toBeNull();
    expect(profileShareMessage('@', 'Athanor')).toBeNull();
    expect(profileShareMessage(null, 'Athanor')).toBeNull();
    expect(profileShareMessage(undefined, 'Athanor')).toBeNull();
  });

  // Guards the deferral documented on the builder: profiles are not anon-readable by
  // default, so a /@handle link would 404 for every member who has not opted a field
  // public. If a URL is added, that has to be a decision, not a drift.
  it('carries no URL while public profile pages are not anon-readable by default', () => {
    expect(profileShareMessage('gio_musica', 'Athanor')).not.toMatch(/https?:\/\//);
  });
});
