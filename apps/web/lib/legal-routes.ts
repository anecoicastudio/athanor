import type { MessageKey } from '@athanor/i18n';

/**
 * The legal pages, in footer order. The landing footer, every legal page's footer and the sitemap
 * read this list, so a new legal page is one entry here plus its route — not a hunt through every
 * file that spells the paths (#779 found seven). The sitemap and prerender tests keep their own
 * literal lists on purpose: a test derived from this constant would pass with an entry missing.
 */
export const LEGAL_ROUTES = [
  { path: '/privacy', label: 'legal.privacy' },
  { path: '/terms', label: 'legal.terms' },
  { path: '/delete-account', label: 'legal.deleteAccount' },
  { path: '/child-safety', label: 'legal.childSafety' },
] as const satisfies readonly { path: `/${string}`; label: MessageKey }[];
