/**
 * External destinations (P3.4). URLs/addresses are configuration, not copy —
 * rule #5 (i18n) covers user-facing strings only. The legal pages live on the
 * external marketing site; update here if the domain changes (P1.3).
 *
 * Every destination derives from SITE_ORIGIN. Spell a new one as
 * `${SITE_ORIGIN}/path`, never as its own literal: `links.test.ts` anchors
 * SITE_ORIGIN to `app.json`'s associated domain, so a derived constant is
 * host-checked for free, while a fresh literal would escape that check until
 * someone remembered to add it to the test's list.
 */
export const SITE_ORIGIN = 'https://www.athanor.workers.dev';

export const LEGAL_TERMS_URL = `${SITE_ORIGIN}/terms`;
export const LEGAL_PRIVACY_URL = `${SITE_ORIGIN}/privacy`;
export const SUPPORT_EMAIL = 'info.anecoica@gmail.com';
export const INVITE_URL_BASE = `${SITE_ORIGIN}/invite`;
