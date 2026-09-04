/**
 * Canonical site origin — used for metadataBase, robots and the sitemap.
 * The fallback matches the deployed origin that AASA/assetlinks and the native
 * app.json associate with (deep links only work on this host). `www.athanor.world`
 * is the custom domain (#471); the Worker's `*.workers.dev` host 308s here via
 * `next.config.ts`. Change the host in all four places together, never one.
 */
// `||`, not `??`: a missing or cleared GitHub Actions secret interpolates as the
// empty string rather than staying unset, so `??` would keep it and `new URL('')`
// in app/layout.tsx would throw mid-build.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.athanor.world';
