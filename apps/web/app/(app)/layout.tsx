import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getOwnProfile } from '@kaira/api';
import { typography } from '@kaira/config';
import { t } from '@kaira/i18n';
import { signOut } from '@/app/actions/auth';
import { Avatar } from '@/components/ui/avatar';
import { I18nProvider } from '@/lib/i18n';
import { createClient } from '@/utils/supabase/server';

/**
 * Authed app shell (DESIGN.md §6 web-app world): wordmark left, avatar right.
 * The proxy already guards these routes (auth + complete-profile); the getUser
 * check here is defensive. Locale seeds the client I18nProvider from the profile.
 *
 * Center nav (Home/Community/Live/Momenti) is intentionally deferred — those
 * routes don't exist until later milestones.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const profile = await getOwnProfile(supabase, user.id);
  const locale = profile?.locale ?? 'it';

  return (
    <I18nProvider locale={locale}>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <Link
            href="/profilo"
            className="text-sm font-semibold tracking-[0.3em] text-luce"
            aria-label={typography.wordmark}
          >
            {typography.wordmark}
          </Link>
          <div className="flex items-center gap-4">
            <form action={signOut}>
              <button
                type="submit"
                className="text-[13px] text-muted-foreground underline-offset-4 hover:underline"
              >
                {t('auth.signOut', locale)}
              </button>
            </form>
            <Link href="/profilo" aria-label="Profilo" className="rounded-full">
              <Avatar handle={profile?.handle ?? null} size={36} />
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[680px] flex-1 px-5 py-8">{children}</main>
      </div>
    </I18nProvider>
  );
}
