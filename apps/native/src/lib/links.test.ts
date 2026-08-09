import { describe, expect, it } from 'vitest';
import { INVITE_URL_BASE, LEGAL_PRIVACY_URL, LEGAL_TERMS_URL, SUPPORT_EMAIL } from './links';

describe('external destinations', () => {
  // These are configuration the app opens blind (Linking.openURL / mailto:) — a typo ships
  // a dead legal page or a bouncing support address with no compile-time signal.
  it('legal and invite URLs are https and parseable', () => {
    for (const url of [LEGAL_TERMS_URL, LEGAL_PRIVACY_URL, INVITE_URL_BASE]) {
      expect(new URL(url).protocol).toBe('https:');
    }
  });

  it('support email has a mailbox and a domain', () => {
    expect(SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });
});
