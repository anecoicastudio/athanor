import Link from 'next/link';
import { t } from '@athanor/i18n';
import { getEditionAuditTrail } from '@athanor/api';
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
 * The cycle is named by its id rather than re-fetched: the operator arrived from the index,
 * which showed the phase and the dates, and a second read would buy nothing this page shows.
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
  const { rows, excluded, nextCursor } = await getEditionAuditTrail(supabase, id, { cursor });

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/admin/fund" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t('admin.fund.back', locale)}
        </Link>
        <h1 className="text-2xl font-semibold">{t('admin.fund.title', locale)}</h1>
        <p className="font-mono text-xs text-muted-foreground">{id}</p>
      </header>

      <AuditTrail audit={rows} excluded={excluded} locale={locale} />

      {nextCursor && (
        <a
          href={`/admin/fund/${id}?cursor=${encodeURIComponent(nextCursor)}`}
          className="text-sm text-muted-foreground"
        >
          {t('admin.queue.more', locale)}
        </a>
      )}
    </section>
  );
}
