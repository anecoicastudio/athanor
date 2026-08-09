import Link from 'next/link';
import { redirect } from 'next/navigation';
import { t } from '@athanor/i18n';
import { typography } from '@athanor/config';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';
import { isAdmin } from '@/lib/is-admin';
import { SessionKeepalive } from '@/components/session-keepalive';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createAuthedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user)) redirect('/admin/login');

  const locale = await getLocale();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SessionKeepalive />
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold tracking-[0.3em]">{typography.wordmark}</span>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin" className="text-muted-foreground hover:text-foreground">
              {t('admin.queue.title', locale)}
            </Link>
            <Link href="/admin/waitlist" className="text-muted-foreground hover:text-foreground">
              {t('admin.waitlist.title', locale)}
            </Link>
          </nav>
        </div>
        <form action="/admin/auth/signout" method="post">
          <button className="text-muted-foreground" type="submit">
            {t('admin.signout', locale)}
          </button>
        </form>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  );
}
