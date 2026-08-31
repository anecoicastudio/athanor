import { notFound } from 'next/navigation';
import { localeTag, t } from '@athanor/i18n';
import { getReportDetail, signMediaUrls } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';
import { VerdictForm } from '@/components/admin/VerdictForm';
import { AuditTrail } from '@/components/admin/AuditTrail';
import { ReportedMessage } from '@/components/admin/ReportedMessage';

export const dynamic = 'force-dynamic';

/** Seconds a reported image's signed URL stays valid. See the note at its call site. */
const EVIDENCE_URL_TTL = 300;

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
  // Signed here rather than in `getReportDetail` so the ephemeral URL never enters the report
  // SHAPE — the schema describes a row, and a signed URL is not one. `EVIDENCE_URL_TTL`
  // deliberately undercuts the bucket's hour: a storage predicate is evaluated when a URL is
  // MINTED, not when it is used, so an hour-long link outlives the verdict that justified it
  // and keeps working after the report is resolved. The page is `force-dynamic`, so it re-signs
  // on every view and nothing is lost by the shorter life. (`signMediaUrls` asks callers to pass
  // `expiresIn` only to go SHORTER — packages/api/src/storage.ts:94 — but the parameter is an
  // unclamped number, so that is a convention this call keeps, not one it is held to.)
  const mediaKey = report.reportedMessage?.media_url ?? null;
  const signed: Record<string, string> = mediaKey
    ? // A signing failure must not take the verdict page down: the report, its note and its
      // audit trail are still the thing the moderator came for, and the evidence block says
      // «no longer available» rather than the page saying nothing at all.
      await signMediaUrls(supabase, 'chat-media', [mediaKey], EVIDENCE_URL_TTL).catch(
        () => ({}) as Record<string, string>,
      )
    : {};
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
          {new Date(report.created_at).toLocaleDateString(localeTag(locale))}
        </p>
      </header>
      {report.note && (
        <p className="rounded-[14px] border border-border bg-card p-4">{report.note}</p>
      )}
      {report.target_type === 'message' && (
        <ReportedMessage
          message={report.reportedMessage}
          state={report.reportedMessageState}
          {...(mediaKey && signed[mediaKey] ? { imageUrl: signed[mediaKey] } : {})}
          locale={locale}
        />
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
