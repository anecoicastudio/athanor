import Link from 'next/link';
import { t } from '@athanor/i18n';
import { getFundEditionIndex } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';

export const dynamic = 'force-dynamic';

/**
 * Fund cycle index (#432) — the way into a cycle's audit trail.
 *
 * Every fund transition has journalled an `audit_log` row since #219, and until now nothing
 * read them: the only reader filtered `report_id`, which the `audit_log_fund_shape` CHECK
 * forbids a fund row to carry. This index and the detail page below it are the entry point
 * those rows never had. Read-only on purpose — a cycle is driven by the edge functions, and
 * nothing here writes.
 *
 * Deliberately small: a cycle is a months-long object, so this is a handful of rows, not a
 * fund console. Reads through `createAuthedClient()` like every other admin page — the
 * operator's own session, gated by `audit_log_select_admin` / `athanor.is_admin()`, never a
 * service-role client.
 */
export default async function AdminFundIndex({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const [supabase, locale] = await Promise.all([createAuthedClient(), getLocale()]);
  const { rows, excluded, nextCursor } = await getFundEditionIndex(supabase, { cursor });
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB');

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('admin.fund.title', locale)}</h1>

      {rows.length === 0 && excluded === 0 ? (
        <p className="text-muted-foreground">{t('admin.fund.empty', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((e) => (
            <li key={e.id}>
              <Link
                href={`/admin/fund/${e.id}`}
                className="flex flex-col gap-1 rounded-[14px] border border-border bg-card p-4 hover:border-aura"
              >
                <span className="font-semibold">
                  {t(`admin.fund.phase.${e.phase}` as Parameters<typeof t>[0], locale)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('admin.fund.opened', locale)} {day(e.created_at)} ·{' '}
                  {t('admin.fund.target', locale)} {day(e.target_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* A cycle the reader could not validate is named, not quietly skipped — same reason
          the audit trail counts its own withheld rows. */}
      {excluded > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('admin.audit.withheld', locale, { count: excluded })}
        </p>
      ) : null}

      {nextCursor && (
        <a
          href={`/admin/fund?cursor=${encodeURIComponent(nextCursor)}`}
          className="text-sm text-muted-foreground"
        >
          {t('admin.queue.more', locale)}
        </a>
      )}
    </section>
  );
}
