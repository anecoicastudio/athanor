import { t, type Locale } from '@athanor/i18n';
import type { AuditLogRow } from '@athanor/schemas';

/**
 * AuditTrail — server component listing the append-only audit log for a report.
 * locale is threaded as a prop from the detail page (same pattern as Task 7).
 */
export function AuditTrail({ audit, locale }: { audit: AuditLogRow[]; locale: Locale }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{t('admin.audit.title', locale)}</h2>
      {audit.length === 0 ? (
        <p className="text-muted-foreground">{t('admin.audit.empty', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {audit.map((a) => (
            <li key={a.id} className="text-sm text-muted-foreground">
              {t(`admin.action.${a.action}` as Parameters<typeof t>[0], locale)}
              {a.penalty_points != null ? ` (${a.penalty_points})` : ''} — {a.reason ?? ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
