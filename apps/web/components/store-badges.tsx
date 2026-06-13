import { t, type Locale } from '@auria/i18n';

/**
 * Download CTAs — App Store + Google Play, in the standard two-line badge
 * layout (small lead line + store name + brand glyph). Monochrome on a dark
 * hairline pill to stay on-brand («calma ma potente», DESIGN.md §6 thin-line) —
 * no aura cyan, no colored marketing art. The app isn't published yet, so the
 * badges are non-interactive "coming soon" marks (no dead links); swap them to
 * <a href> store URLs here in one place at launch. `locale` is threaded from the
 * page so the badges follow the in-page IT/EN toggle.
 */
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
  ariaLabel,
  glyph,
  small,
  name,
}: {
  ariaLabel: string;
  glyph: React.ReactNode;
  small: string;
  name: string;
}) {
  // The app isn't published yet — render a non-interactive "coming soon" badge
  // (no dead href). Swap to an <a href> with the store URL at launch.
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="inline-flex cursor-default items-center gap-3 rounded-2xl border border-border bg-card/40 px-5 py-2.5 text-foreground opacity-70"
    >
      {glyph}
      <span className="flex flex-col text-left leading-tight">
        <span className="text-[10px] tracking-wide text-muted-foreground">{small}</span>
        <span className="text-base font-semibold tracking-tight">{name}</span>
      </span>
    </div>
  );
}

export function StoreBadges({ className, locale = 'it' }: { className?: string; locale?: Locale }) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Badge
          ariaLabel={t('landing.download.appStore', locale)}
          glyph={<AppleGlyph />}
          small={t('landing.download.appStoreSmall', locale)}
          name={t('landing.download.appStoreName', locale)}
        />
        <Badge
          ariaLabel={t('landing.download.googlePlay', locale)}
          glyph={<PlayGlyph />}
          small={t('landing.download.googlePlaySmall', locale)}
          name={t('landing.download.googlePlayName', locale)}
        />
      </div>
      <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {t('landing.download.comingSoon', locale)}
      </span>
    </div>
  );
}
