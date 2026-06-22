import Link from 'next/link';
import { t, type Locale } from '@athanor/i18n';

const TABS = ['open', 'reviewing', 'resolved'] as const;

export function StatusTabs({ active, locale }: { active: string; locale: Locale }) {
  return (
    <nav className="flex gap-2">
      {TABS.map((s) => (
        <Link
          key={s}
          href={`/admin?status=${s}`}
          className={`rounded-full px-3 py-1 text-sm ${
            active === s ? 'bg-aura text-on-aura' : 'border border-border text-muted-foreground'
          }`}
        >
          {t(`admin.status.${s}`, locale)}
        </Link>
      ))}
    </nav>
  );
}
