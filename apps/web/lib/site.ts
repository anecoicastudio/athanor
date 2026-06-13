/**
 * Canonical site origin — used for metadataBase, robots and the sitemap.
 * Set NEXT_PUBLIC_SITE_URL to the real production domain at deploy time; the
 * fallback is a placeholder only.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://auria.app';
