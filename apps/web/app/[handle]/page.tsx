import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { t } from '@athanor/i18n';
import { getPublicProfileByHandle } from '@athanor/api';
import { getLocale } from '@/lib/get-locale';
import { resolveHandle } from '@/lib/resolve-handle';
import { createClient } from '@/utils/supabase/server';
import { PublicProfileView } from '@/components/public-profile-view';

// ISR: re-fetch a public profile at most every 5 minutes (Dynamic SSR + ISR).
export const revalidate = 300;

async function load(rawSegment: string) {
  const handle = resolveHandle(rawSegment);
  if (!handle) return null;
  const supabase = await createClient();
  return getPublicProfileByHandle(supabase, handle);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: raw } = await params;
  const locale = await getLocale();
  const profile = await load(raw);
  if (!profile) {
    return { title: `${t('profile.unavailable', locale)} — ${t('app.name', locale)}` };
  }
  const description = profile.dream?.text ?? profile.bio ?? t('app.tagline', locale);
  return {
    title: `@${profile.handle} — ${t('app.name', locale)}`,
    description,
    openGraph: { title: `@${profile.handle}`, description },
    robots: { index: true, follow: true },
  };
}

export default async function HandlePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const profile = await load(raw);
  if (!profile) notFound();
  const locale = await getLocale();
  return <PublicProfileView profile={profile} locale={locale} />;
}
