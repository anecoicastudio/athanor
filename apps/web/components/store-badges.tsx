import { t } from '@auria/i18n';

/**
 * Download CTAs — App Store + Google Play, in the standard two-line badge
 * layout (small lead line + store name + brand glyph). Monochrome on a dark
 * hairline pill to stay on-brand («calma ma potente», DESIGN.md §6 thin-line) —
 * no aura cyan, no colored marketing art. Placeholder links (href="#") until
 * the app is published; swap the hrefs here in one place.
 */
const L = 'it' as const;

function AppleGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="20" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 3.5 L19.5 12 L4 20.5 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Badge({
  href,
  ariaLabel,
  glyph,
  small,
  name,
}: {
  href: string;
  ariaLabel: string;
  glyph: React.ReactNode;
  small: string;
  name: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-3 rounded-2xl border border-border bg-card/40 px-5 py-2.5 text-foreground transition-opacity hover:opacity-80"
    >
      {glyph}
      <span className="flex flex-col text-left leading-tight">
        <span className="text-[10px] tracking-wide text-muted-foreground">{small}</span>
        <span className="text-base font-semibold tracking-tight">{name}</span>
      </span>
    </a>
  );
}

export function StoreBadges({ className }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-4 ${className ?? ''}`}>
      <Badge
        href="#"
        ariaLabel={t('landing.download.appStore', L)}
        glyph={<AppleGlyph />}
        small={t('landing.download.appStoreSmall', L)}
        name={t('landing.download.appStoreName', L)}
      />
      <Badge
        href="#"
        ariaLabel={t('landing.download.googlePlay', L)}
        glyph={<PlayGlyph />}
        small={t('landing.download.googlePlaySmall', L)}
        name={t('landing.download.googlePlayName', L)}
      />
    </div>
  );
}
