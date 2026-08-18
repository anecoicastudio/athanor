import { notFound } from 'next/navigation';
import { t } from '@athanor/i18n';
import { getReportDetail } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';
import { VerdictForm } from '@/components/admin/VerdictForm';
import { AuditTrail } from '@/components/admin/AuditTrail';

export const dynamic = 'force-dynamic';

export default async function ReportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [supabase, locale] = await Promise.all([createAuthedClient(), getLocale()]);
  let report: Awaited<ReturnType<typeof getReportDetail>>;
  try {
    report = await getReportDetail(supabase, id);
  } catch {
    notFound();
  }
  const resolved = report.status === 'upheld' || report.status === 'dismissed';
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {t(`report.reason.${report.category}` as Parameters<typeof t>[0], locale)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(`admin.target.${report.target_type}` as Parameters<typeof t>[0], locale)}
          {report.target_handle ? ` · @${report.target_handle}` : ''} ·{' '}
          {t('admin.report.reporter', locale)} @{report.reporter_handle ?? '—'}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('admin.report.filed', locale)}{' '}
          {new Date(report.created_at).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB')}
        </p>
      </header>
      {report.note && (
        <p className="rounded-[14px] border border-border bg-card p-4">{report.note}</p>
      )}
      {resolved ? (
        <p className="rounded-[14px] border border-border bg-card p-4">
          <span className="font-semibold text-aura">
            {t(`admin.status.${report.status}` as Parameters<typeof t>[0], locale)}
          </span>
          {report.resolution ? ` — ${report.resolution}` : ''}
        </p>
      ) : (
        <VerdictForm reportId={report.id} locale={locale} targetType={report.target_type} />
      )}
      <AuditTrail audit={report.audit} excluded={report.auditExcluded} locale={locale} />
    </section>
  );
}
