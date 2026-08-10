import type { Locale } from '@athanor/i18n';

/**
 * The locale the server renders. IT is canonical (PRD §4.14), and every public
 * page is now prerendered at build time, so there is no request cookie to read —
 * see lib/get-locale.ts, which survives for /admin only.
 *
 * EN is a post-hydration switch handled by components/locale-provider.tsx. That
 * is not an SEO regression: there is no EN URL and no hreflang, so crawlers have
 * only ever been served IT.
 */
export const DEFAULT_LOCALE: Locale = 'it';
