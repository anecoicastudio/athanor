import { t } from '@athanor/i18n';
import { getWaitlistCount, getWaitlistPage } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';
import { getLocale } from '@/lib/get-locale';

export const dynamic = 'force-dynamic';

/**
 * Pre-launch waitlist dashboard: the headline interest count + the signups, newest first,
 * one keyset page at a time (#335 — the report queue's model, `?cursor=`), with a CSV
 * export. Reads through the admin-gated DEFINER RPCs (getWaitlistCount / getWaitlistPage)
 * — the table itself stays unreadable by clients. Layout already enforces isAdmin(); the
 * RPCs re-check is_admin() server-side.
 */
export default async function AdminWaitlist({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const { cursor: rawCursor } = await searchParams;
  // `?cursor=a&cursor=b` arrives as an array; the first is the link that was clicked.
  const cursor = Array.isArray(rawCursor) ? rawCursor[0] : rawCursor;
  const [supabase, locale] = await Promise.all([createAuthedClient(), getLocale()]);
  const [count, { rows, excluded, nextCursor }] = await Promise.all([
    getWaitlistCount(supabase),
    getWaitlistPage(supabase, { cursor }),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('admin.waitlist.title', locale)}</h1>
        <a
          href="/admin/waitlist/export"
          download
          className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {t('admin.waitlist.export', locale)}
        </a>
      </div>

      <p className="text-4xl font-semibold">
        {count}{' '}
        <span className="text-base font-normal text-muted-foreground">
          {t('admin.waitlist.count', locale)}
        </span>
      </p>

      {rows.length === 0 && excluded === 0 ? (
        <p className="text-muted-foreground">{t('admin.waitlist.empty', locale)}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 font-normal">{t('admin.waitlist.colEmail', locale)}</th>
              <th className="py-2 font-normal">{t('admin.waitlist.colSource', locale)}</th>
              <th className="py-2 font-normal">{t('admin.waitlist.colWhen', locale)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2">{r.email}</td>
                <td className="py-2 text-muted-foreground">{r.source ?? '—'}</td>
                <td className="py-2 text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString(locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {excluded > 0 && (
        // Rows the reader could not validate are withheld and counted, never shown as
        // valid or dropped in silence (api.md) — the same line the fund audit shows.
        <p className="text-sm text-muted-foreground">
          {t('admin.audit.withheld', locale, { count: excluded })}
        </p>
      )}

      {nextCursor && (
        <a
          href={`/admin/waitlist?cursor=${encodeURIComponent(nextCursor)}`}
          className="text-sm text-muted-foreground"
        >
          {t('admin.queue.more', locale)}
        </a>
      )}
    </section>
  );
}
