import Link from 'next/link';
import { t, type Locale } from '@athanor/i18n';
import type { AdminReportRow } from '@athanor/api';

export function ReportRow({ row, locale }: { row: AdminReportRow; locale: Locale }) {
  return (
    <li>
      <Link
        href={`/admin/reports/${row.id}`}
        className="flex items-center justify-between rounded-[14px] border border-border bg-card px-4 py-3 hover:border-aura"
      >
        <span className="flex flex-col">
          <span className="font-semibold">
            {t(`report.reason.${row.category}` as Parameters<typeof t>[0], locale)}
          </span>
          <span className="text-sm text-muted-foreground">
            {row.target_type} · {t('admin.report.reporter', locale)} @{row.reporter_handle ?? '—'}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {t(`admin.status.${row.status}` as Parameters<typeof t>[0], locale)}
        </span>
      </Link>
    </li>
  );
}
