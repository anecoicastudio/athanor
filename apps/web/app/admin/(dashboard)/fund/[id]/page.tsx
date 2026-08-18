import Link from 'next/link';
import { notFound } from 'next/navigation';
import { t } from '@athanor/i18n';
import { getEditionAuditTrail, getFundEdition } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';
import { AuditTrail } from '@/components/admin/AuditTrail';

export const dynamic = 'force-dynamic';

/**
 * One cycle's audit trail (#432) — the thirteen fund transitions, newest first.
 *
 * `AuditTrail` is reused unchanged: it already interpolates `admin.action.*`, and #420 put
 * the fund half of that vocabulary in both catalogs, so these rows have rendered correctly
 * for as long as anything has been able to fetch them.
 *
 * The header is fetched rather than inferred from the id because an empty trail is ambiguous
 * on its own: a cycle that has just opened has no audit rows either (none of the thirteen
 * actions fires at open). Without the lookup, a mistyped id renders as a real, quiet cycle —
 * evidence-shaped nothing, which is the failure this issue exists to end. A cycle the schema
 * rejects still shows its trail: the header degrades to the raw id, the trail is the point.
 */
export default async function AdminFundAudit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const [{ id }, { cursor }] = await Promise.all([params, searchParams]);
  const [supabase, locale] = await Promise.all([createAuthedClient(), getLocale()]);
  const [edition, trail] = await Promise.all([
    getFundEdition(supabase, id),
    getEditionAuditTrail(supabase, id, { cursor }),
  ]);
  if (!edition.row && edition.excluded === 0) notFound();
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB');

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/admin/fund" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t('admin.fund.back', locale)}
        </Link>
        <h1 className="text-2xl font-semibold">
          {edition.row
            ? t(`admin.fund.phase.${edition.row.phase}` as Parameters<typeof t>[0], locale)
            : t('admin.fund.title', locale)}
        </h1>
        {edition.row ? (
          <p className="text-sm text-muted-foreground">
            {t('admin.fund.opened', locale)} {day(edition.row.created_at)} ·{' '}
            {t('admin.fund.target', locale)} {day(edition.row.target_at)}
          </p>
        ) : null}
        <p className="font-mono text-xs text-muted-foreground">{id}</p>
      </header>

      <AuditTrail audit={trail.rows} excluded={trail.excluded} locale={locale} />

      {trail.nextCursor && (
        <a
          href={`/admin/fund/${id}?cursor=${encodeURIComponent(trail.nextCursor)}`}
          className="text-sm text-muted-foreground"
        >
          {t('admin.queue.more', locale)}
        </a>
      )}
    </section>
  );
}
