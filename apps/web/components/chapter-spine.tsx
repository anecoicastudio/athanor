'use client';

import { useEffect, useState } from 'react';
import { t, type Locale, type MessageKey } from '@auria/i18n';
import { Mandorla } from '@/components/mandorla';

export type Chapter = { id: string; label: MessageKey };

/**
 * ChapterSpine — the sticky left rail of the landing's narrative (the
 * split-screen, minimal/elegant layout, medusmo.com-inspired: one dark canvas,
 * type-led, restraint over decoration). A small echo of the hero Mandorla over a
 * vertical chapter index; the chapter in view is tracked via IntersectionObserver
 * and highlighted (foreground text + an extended marker), the rest muted — the
 * DESIGN.md §6 "vertical spine" motif repurposed as section nav.
 *
 * One component, two presentations: a labelled sticky aside on ≥lg, and a slim
 * fixed dot rail on mobile (decorative, aria-hidden — the per-chapter inline
 * eyebrows carry the semantics on small screens). Index numbers intentionally
 * omitted (DESIGN.md §11, 2026-06-13). Tokens only; the active state reads through
 * foreground weight + marker length, never the aura cyan (reserved for moments).
 */
export function ChapterSpine({ chapters, locale }: { chapters: Chapter[]; locale: Locale }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const sections = chapters
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // a thin band around the upper-middle of the viewport marks the active chapter
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = chapters.findIndex((c) => c.id === entry.target.id);
          if (idx !== -1) setActive(idx);
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [chapters]);

  return (
    <>
      {/* ≥lg — sticky labelled spine */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-center lg:gap-14 lg:py-24">
        <div className="h-16 w-16" aria-hidden>
          <Mandorla idPrefix="spine" loop className="h-full w-full" />
        </div>
        <nav aria-label={t('landing.chapters.nav', locale)}>
          <ol className="flex flex-col gap-4">
            {chapters.map((c, i) => (
              <li key={c.id}>
                <a
                  href={`#${c.id}`}
                  aria-current={i === active ? 'true' : undefined}
                  className="group flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em]"
                >
                  <span
                    className={`h-px transition-all duration-300 ${
                      i === active
                        ? 'w-8 bg-foreground'
                        : 'w-4 bg-muted-foreground group-hover:bg-foreground'
                    }`}
                  />
                  <span
                    className={`transition-colors ${
                      i === active
                        ? 'text-foreground'
                        : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  >
                    {t(c.label, locale)}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </aside>

      {/* <lg — slim fixed dot rail (decorative; inline eyebrows carry the labels) */}
      <div
        aria-hidden
        className="fixed right-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2.5 lg:hidden"
      >
        {chapters.map((c, i) => (
          <span
            key={c.id}
            className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
              i === active ? 'scale-125 bg-foreground' : 'bg-muted-foreground/40'
            }`}
          />
        ))}
      </div>
    </>
  );
}
