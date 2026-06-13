import { t } from '@auria/i18n';

/**
 * Download CTAs — App Store + Google Play. Placeholder links (href="#") until
 * the app is published; swap the hrefs (and, at launch, the marks for the
 * official store badges) here in one place.
 *
 * Style follows DESIGN.md §6 thin-line language: hairline pill, currentColor
 * glyph, no filled marketing art, no aura cyan (download is not a "moment").
 */
const L = 'it' as const;

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 3.5 L19 12 L5 20.5 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StoreBadges({ className }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-4 ${className ?? ''}`}>
      <a
        href="#"
        aria-label={t('landing.download.appStore', L)}
        className="inline-flex items-center gap-3 rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition-opacity hover:opacity-80"
      >
        <AppleGlyph />
        {t('landing.download.appStore', L)}
      </a>
      <a
        href="#"
        aria-label={t('landing.download.googlePlay', L)}
        className="inline-flex items-center gap-3 rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition-opacity hover:opacity-80"
      >
        <PlayGlyph />
        {t('landing.download.googlePlay', L)}
      </a>
    </div>
  );
}
