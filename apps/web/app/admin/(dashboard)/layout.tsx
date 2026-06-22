import { redirect } from 'next/navigation';
import { t } from '@athanor/i18n';
import { typography } from '@athanor/config';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createAuthedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAdmin = (user?.app_metadata as { role?: string } | undefined)?.role === 'admin';
  if (!isAdmin) redirect('/admin/login');

  const locale = await getLocale();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-semibold tracking-[0.3em]">{typography.wordmark}</span>
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
