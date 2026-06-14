import { Fragment } from 'react';
import { t } from '@athanor/i18n';
import { cn } from '@/lib/utils';

/**
 * Crossbar-less Λ peak standing in for an "A". Hanken Grotesk ships no Greek Λ
 * glyph, so to keep the wordmark in Hanken sans (matching the vertical section
 * labels) *and* render the brand's lambda A's, the A is drawn here. em-sized →
 * scales with the surrounding font-size; `currentColor`; the box bottom sits on
 * the text baseline (align-baseline) at cap height, so it lines up with the
 * letters beside it. `strokeWidth` is tuned by eye to Hanken 400. Pass a
 * `className` (e.g. `mx-[…em]`) to add side-bearings where the bare peak reads
 * too tight against a neighbour.
 */
export function LambdaA({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 66 72"
      className={cn('inline-block h-[0.72em] w-[0.66em] align-baseline', className)}
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
 * Renders a translated string with the brand name set as the uppercase logotype
 * `ΛTHΛNOR` — both A's drawn as the logo's Λ peak (<LambdaA>) — so an inline
 * "Athanor" in copy reads like the logo (user request 2026-06-13 — scope: the
 * download headline; uppercased on request).
 *
 * The brand token is derived from i18n (rule 5 — no hardcoded letters): split on
 * `app.name` ("Athanor"), then render its uppercase form letter by letter, each
 * `A` → the peak (with an `mx` side-bearing so it doesn't crowd the `U`), the
 * rest as uppercase text in the inherited font. The visible glyphs are
 * `aria-hidden`; a visually-hidden copy of the plain `text` carries the real
 * words for screen readers / SEO (so AT hears "Take Athanor with you.").
 */
export function BrandText({ text }: { text: string }) {
  const brand = t('app.name', 'it'); // "Athanor"
  const upper = brand.toUpperCase(); // "ATHANOR"
  const parts = text.split(brand);
  return (
    <>
      <span aria-hidden>
        {parts.map((part, i) => (
          <Fragment key={i}>
            {part}
            {i < parts.length - 1 && (
              <span className="font-sans tracking-[0.14em]">
                {[...upper].map((ch, j) =>
                  ch === 'A' ? (
                    <LambdaA key={j} className="mx-[0.06em]" />
                  ) : (
                    <span key={j}>{ch}</span>
                  ),
                )}
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
 * ATHANOR wordmark (DESIGN.md §4 wordmark rule + §11). "ATHANOR" in the body sans
 * (Hanken Grotesk, `font-sans`), uppercase + letterspaced — matching the vertical
 * section labels (2026-06-13) — with the A's drawn as a Λ peak (<LambdaA>, since
 * Hanken has no Greek Λ; user request 2026-06-13). The lambdas carry a small
 * `mx` to emulate the side-bearings the bare peak lacks, so they don't crowd the
 * `U`/`I`. Derived from the i18n brand name so there are no hardcoded user-facing
 * strings (rule 5): the visible glyphs are decorative (`aria-hidden`) and the
 * accessible name comes from `aria-label`, so a screen reader hears "Athanor".
 *
 * Letterspaced per §4 (callers can override the tracking via className — twMerge
 * resolves the conflict). Color follows `currentColor` (foreground by default —
 * never aura cyan).
 */
export function AthanorWordmark({ className }: { className?: string }) {
  const name = t('app.name', 'it').toUpperCase(); // "ATHANOR"
  return (
    <span
      aria-label={t('app.name', 'it')}
      className={cn('font-sans uppercase leading-none tracking-[0.3em] select-none', className)}
    >
      <span aria-hidden>
        {[...name].map((ch, i) =>
          ch === 'A' ? <LambdaA key={i} className="mx-[0.26em]" /> : <span key={i}>{ch}</span>,
        )}
      </span>
    </span>
  );
}
