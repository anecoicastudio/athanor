import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { t } from '@athanor/i18n';
import { getPublicProfileByHandle } from '@athanor/api';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
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

export async function generateStaticParams() {
  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('handle')
      .not('handle', 'is', null);
    if (error) throw error;
    return (
      (data ?? [])
        .filter((p): p is { handle: string } => Boolean(p.handle))
        // The route rejects a segment without the leading @ (lib/resolve-handle.ts).
        .map((p) => ({ handle: `@${p.handle}` }))
    );
  } catch (e) {
    // env/network unavailable at build → prerender nothing, serve every handle on
    // demand. Loud on purpose: silently returning [] looks identical to "no
    // profiles exist" and would quietly un-prerender the whole route.
    console.warn('[handle] generateStaticParams failed, prerendering no profiles:', e);
    return [];
  }
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
    // Name the site-wide card explicitly. Next replaces `openGraph` rather than
    // merging it, so declaring this object at all drops the parent's image — and
    // the layout's `summary_large_image` would then promise a card with no picture.
    // The per-handle Satori route that used to fill this slot is gone (10 ms CPU budget).
    openGraph: { title: `@${profile.handle}`, description, images: ['/opengraph-image'] },
    twitter: { images: ['/opengraph-image'] },
    robots: { index: true, follow: true },
  };
}

export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const profile = await load(raw);
  if (!profile) notFound();
  return <PublicProfileClient profile={profile} />;
}
