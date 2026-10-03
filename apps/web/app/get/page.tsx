import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { t } from '@athanor/i18n';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { resolveStoreTarget } from '@/lib/store-links';
import { GetView } from '@/components/get-view';

/**
 * `/get` — the one link that leads to the app (#269): every store badge on the site, the
 * printed QR, the app's own force-update button.
 *
 * It exists because an App Store URL names one country's storefront (`lib/store-links.ts`), so
 * no prerendered page can carry the right one. An iPhone is redirected to the storefront of the
 * country Cloudflare saw the request arrive from, an Android phone to Google Play, and anyone
 * else gets `GetView`: both badges and a storefront picker.
 *
 * The one deliberately per-request public page. `cf-ipcountry` is the header Cloudflare adds
 * with the visitor's country — believed, unverified on this Worker as of 2026-10-03: nothing
 * else in `apps/web` reads it, and OpenNext does not synthesise it. Any value outside the
 * storefront list, and no header at all, is «cannot tell» to `resolveStoreTarget`, so the
 * failure mode is the picker for everyone, never a wrong storefront — which is also why a
 * header the visitor's own proxy could influence is acceptable here. Being dynamic also keeps it out of the KV incremental cache: one visitor's storefront must
 * never be served to the next.
 *
 * Kept out of the AASA paths and the Android intent filters on purpose. If the app claimed
 * `/get`, tapping it with Athanor installed would open the app instead of the store.
 *
 * noindex — a hand-off, like `/invite` and `/post`.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${t('landing.download.title', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
  description: t('get.body', DEFAULT_LOCALE),
  robots: { index: false, follow: false },
};

export default async function GetPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string | string[] }>;
}) {
  const [{ store }, requestHeaders] = await Promise.all([searchParams, headers()]);
  const target = resolveStoreTarget({
    userAgent: requestHeaders.get('user-agent'),
    country: requestHeaders.get('cf-ipcountry'),
    store: typeof store === 'string' ? store : null,
  });
  if (target.kind === 'redirect') redirect(target.url);
  return <GetView platform={target.platform} />;
}
