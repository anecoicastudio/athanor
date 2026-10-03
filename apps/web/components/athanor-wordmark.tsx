import { Fragment } from 'react';
import { t } from '@athanor/i18n';
import { cn } from '@/lib/utils';

/**
 * Crossbar-less Λ peak standing in for an "A". Hanken Grotesk ships no Greek Λ
 * glyph, so to keep the wordmark in Hanken sans (matching the vertical section
 * labels) *and* render the brand's lambda, the peak is drawn here. em-sized →
 * scales with the surrounding font-size; `currentColor`; the box bottom sits on
 * the text baseline at cap height, so it lines up with the letters beside it.
 * `strokeWidth` is tuned by eye to Hanken 400. The stroke runs to the edge of the
 * box, so the box is the ink — it needs no side-bearing of its own.
 */
export function LambdaA({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 66 72"
      className={cn('inline-block h-[0.72em] w-[0.66em] shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={8}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      strokeMiterlimit={10}
    >
      <path d="M5 70 L33 5 L61 70" />
    </svg>
  );
}

/**
 * The brand's letters, `ATHΛNOR` (Marco's ruling, 2026-10-03, superseding the 2026-06-13
 * `ΛTHΛNOR`): the first A is the font's own glyph, every later A is the drawn peak.
 *
 * Spaced by a flex `gap`, not by `letter-spacing`. Tracking adds its space after a text glyph
 * and not after an inline SVG, so the old lockup patched each peak with hand-tuned margins that
 * held at one size and drifted at the next. A gap is the same distance between every pair of
 * boxes whatever is in them, which is what «equally spaced» means here. `tracking-normal`
 * keeps an inherited letter-spacing from adding to it.
 *
 * Derived from the i18n brand name (rule 5 — no hardcoded letters). Decorative: callers hide it
 * from assistive technology and supply the real name themselves.
 */
function BrandLetters({ gap }: { gap: string }) {
  const letters = [...t('app.name', 'it').toUpperCase()]; // "ATHANOR"
  const firstA = letters.indexOf('A');
  return (
    <span aria-hidden className={cn('inline-flex items-baseline tracking-normal', gap)}>
      {letters.map((ch, i) =>
        ch === 'A' && i !== firstA ? <LambdaA key={i} /> : <span key={i}>{ch}</span>,
      )}
    </span>
  );
}

/**
 * Renders a translated string with the brand name set as the uppercase logotype
 * (`BrandLetters`), so an inline "Athanor" in copy reads like the logo (user request
 * 2026-06-13 — scope: the download headline; uppercased on request).
 *
 * The string is split on `app.name`; the visible glyphs are `aria-hidden`, and a
 * visually-hidden copy of the plain `text` carries the real words for screen readers / SEO
 * (so AT hears "Take Athanor with you."). The logotype is one flex box, so a headline wraps
 * around the name and never inside it.
 */
export function BrandText({ text }: { text: string }) {
  const parts = text.split(t('app.name', 'it'));
  return (
    <>
      <span aria-hidden>
        {parts.map((part, i) => (
          <Fragment key={i}>
            {part}
            {i < parts.length - 1 && (
              <span className="font-sans">
                <BrandLetters gap="gap-[0.14em]" />
              </span>
            )}
          </Fragment>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

/**
 * ATHANOR wordmark (DESIGN.md §4 wordmark rule + §11). The brand's letters in the body sans
 * (Hanken Grotesk, `font-sans`), uppercase and evenly spaced — matching the vertical section
 * labels (2026-06-13). See `BrandLetters` for the letters and for why the spacing is a gap.
 * The accessible name comes from `aria-label`, so a screen reader hears "Athanor".
 *
 * Callers size it with a text-size class. Color follows `currentColor` (foreground by default —
 * never aura cyan).
 */
export function AthanorWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label={t('app.name', 'it')}
      className={cn('inline-flex font-sans uppercase leading-none select-none', className)}
    >
      <BrandLetters gap="gap-[0.3em]" />
    </span>
  );
}
