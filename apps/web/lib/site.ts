/**
 * Canonical site origin — used for metadataBase, robots and the sitemap.
 * The fallback matches the deployed origin that AASA/assetlinks and the native
 * app.json associate with (deep links only work on this host). When a custom
 * domain lands, set NEXT_PUBLIC_SITE_URL and update those three configs together.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://athanor-page.vercel.app';
