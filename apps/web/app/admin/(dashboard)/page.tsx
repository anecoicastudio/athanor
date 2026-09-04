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
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { status, cursor } = await searchParams;
  const tab = (status === 'reviewing' || status === 'resolved' ? status : 'open') as
    | 'open'
    | 'reviewing'
    | 'resolved';
  const [supabase, locale] = await Promise.all([createAuthedClient(), getLocale()]);
  const { rows, nextCursor, handlesExcluded } = await getReportQueue(supabase, {
    status: tab,
    cursor,
  });
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
      {handlesExcluded > 0 && (
        // Handle rows the reader could not validate are withheld and counted (#664): a «—» on
        // this page is then a schema disagreement, not an unnamed report — the same line the
        // waitlist and the fund audit show.
        <p className="text-sm text-muted-foreground">
          {t('admin.audit.withheld', locale, { count: handlesExcluded })}
        </p>
      )}
      {nextCursor && (
        <a
          href={`/admin?status=${tab}&cursor=${encodeURIComponent(nextCursor)}`}
          className="text-sm text-muted-foreground"
        >
          {t('admin.queue.more', locale)}
        </a>
      )}
    </section>
  );
}
