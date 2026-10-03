import { Fragment } from 'react';
import Link from 'next/link';
import { t, type Locale } from '@athanor/i18n';
import { cn } from '@/lib/utils';
import { LEGAL_ROUTES } from '@/lib/legal-routes';

/**
 * The row of legal links in the landing footer and under every legal page. The dots show only
 * from `sm` up: at phone width the links wrap, and a dot would end the first line. Each link
 * is padded to a ~44px tall hit area; that padding is the gap between wrapped rows.
 */
export function LegalNav({ locale, className }: { locale: Locale; className?: string }) {
  return (
    <nav
      className={cn('flex flex-wrap items-center gap-x-6 text-sm text-muted-foreground', className)}
    >
      {LEGAL_ROUTES.map(({ path, label }, i) => (
        <Fragment key={path}>
          {i > 0 ? (
            <span aria-hidden className="hidden sm:inline">
              ·
            </span>
          ) : null}
          <Link href={path} className="py-3 transition-opacity hover:opacity-80">
            {t(label, locale)}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
