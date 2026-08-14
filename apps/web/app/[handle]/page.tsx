import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { t } from '@athanor/i18n';
import { getPublicProfileByHandle } from '@athanor/api';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { handleStaticParams } from '@/lib/handle-static-params';
import { resolveHandle } from '@/lib/resolve-handle';
import { createAnonClient } from '@/utils/supabase/server';
import { PublicProfileClient } from '@/components/public-profile-client';

/*
 * Prerender every known handle at build time and keep serving unknown ones on
 * demand. `dynamicParams: false` would be worse than it looks: a profile created
 * after the last build would 404 until the next one — a confident wrong answer,
 * cached by Google and seen by the person on the link they just shared. A first-hit
 * on-demand render is slower but honest, and the incremental cache keeps it to once.
 */
export const dynamicParams = true;
/*
 * Keep the 5-minute TTL. `revalidate = false` would prerender just as well — what
 * made the route dynamic was cookies(), not the TTL — but it caches user-generated
 * content indefinitely, and nothing in this repo can invalidate it: revalidatePath
 * is only ever called for /admin. That would outlive the M9 erasure job (which
 * deletes the auth.users row and cascades the profile, leaving the dream text
 * served from static HTML) and would freeze a member's `visibility` toggle at
 * whatever it was on the last deploy. A self-healing cache is worth the revalidation.
 */
export const revalidate = 300;

// Body shared with opengraph-image.tsx (lib/handle-static-params.ts) — the image
// route needs its own generateStaticParams export, and the two must not drift.
export async function generateStaticParams() {
  return handleStaticParams();
}

async function load(rawSegment: string) {
  const handle = resolveHandle(rawSegment);
  if (!handle) return null;
  // createAnonClient, not createClient: this page is public and RLS-gated, so it
  // has no session to read — and awaiting cookies() would opt the route back into
  // dynamic rendering for every request, prerendered params included.
  const supabase = createAnonClient();
  return getPublicProfileByHandle(supabase, handle);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  // DEFAULT_LOCALE throughout: crawlers carry no locale cookie, so this metadata
  // was only ever IT anyway.
  const { handle: raw } = await params;
  const profile = await load(raw);
  if (!profile) {
    return {
      title: `${t('profile.unavailable', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
    };
  }
  const description = profile.dream?.text ?? profile.bio ?? t('app.tagline', DEFAULT_LOCALE);
  return {
    title: `@${profile.handle} — ${t('app.name', DEFAULT_LOCALE)}`,
    description,
    // No `images` here: the sibling opengraph-image.tsx fills og:image per handle
    // (#157) — file-based metadata beats these fields, and naming a URL as well
    // would only invite the two to drift. Next replaces `openGraph`/`twitter`
    // rather than merging them, so `twitter` must re-declare the card type or the
    // layout's `summary_large_image` is lost; X then falls back to og:image, the
    // per-handle card.
    openGraph: { title: `@${profile.handle}`, description },
    twitter: { card: 'summary_large_image', title: `@${profile.handle}`, description },
    robots: { index: true, follow: true },
  };
}

export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const profile = await load(raw);
  if (!profile) notFound();
  return <PublicProfileClient profile={profile} />;
}
