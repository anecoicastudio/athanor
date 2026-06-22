import { t } from '@athanor/i18n';
import { getReportQueue } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';
import { ReportRow } from '@/components/admin/ReportRow';
import { StatusTabs } from '@/components/admin/StatusTabs';

export const dynamic = 'force-dynamic';

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const tab = (status === 'reviewing' || status === 'resolved' ? status : 'open') as
    | 'open'
    | 'reviewing'
    | 'resolved';
  const [supabase, locale] = await Promise.all([createAuthedClient(), getLocale()]);
  const { rows } = await getReportQueue(supabase, { status: tab });
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('admin.queue.title', locale)}</h1>
      <StatusTabs active={tab} locale={locale} />
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('admin.queue.empty', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <ReportRow key={r.id} row={r} locale={locale} />
          ))}
        </ul>
      )}
    </section>
  );
}
