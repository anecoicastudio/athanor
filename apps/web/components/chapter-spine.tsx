'use client';

import { useEffect, useState } from 'react';
import type { MessageKey } from '@athanor/i18n';

export type Chapter = { id: string; label: MessageKey };

/**
 * ChapterSpine — a slim, decorative scroll-progress rail for the landing's
 * narrative. The chapter in view is tracked via IntersectionObserver; its tick
 * extends + brightens, the rest stay short and muted (DESIGN.md §11, 2026-06-13 —
 * the labelled table-of-contents was reduced to marks-only on user request, so the
 * narrative reads full-width and the rail no longer competes with the content).
 *
 * Purely decorative (`aria-hidden`) — not a menu: the per-chapter inline eyebrows
 * carry the section semantics. Tokens only; the active state reads through
 * foreground weight + marker length, never the aura cyan (reserved for moments).
 */
export function ChapterSpine({ chapters }: { chapters: Chapter[] }) {
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
    <div aria-hidden className="fixed left-6 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-3">
      {chapters.map((c, i) => (
        <span
          key={c.id}
          className={`h-px transition-all duration-300 ${
            i === active ? 'w-6 bg-foreground' : 'w-2 bg-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  );
}
