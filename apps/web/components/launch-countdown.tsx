'use client';

import { useEffect, useState } from 'react';
import { timeRemaining } from '@athanor/core';
import { localeTag, t, type Locale } from '@athanor/i18n';
import { cn } from '@/lib/utils';

/**
 * Pre-launch countdown to the public open. Numbers are the one place cyan
 * numerals are sanctioned on the public landing (DESIGN.md §2/§9); flat
 * `text-aura`, no glow surface (the glow stays for moment-grade events,
 * CLAUDE.md rule 4). Decomposition reuses the tested pure `timeRemaining` from
 * `@athanor/core` — no business logic lives here.
 *
 * Static marketing site has no server clock, so the deadline is a client const:
 * `LAUNCH_AT` is the single source of truth — the human date in the label is
 * derived from it (no drift). If it slips, edit `LAUNCH_AT` only. Rome is CEST
 * (UTC+2) in September.
 */
const LAUNCH_AT = Date.parse('2026-09-11T00:00:00+02:00');

export function LaunchCountdown({ locale, className }: { locale: Locale; className?: string }) {
  // Null until mounted: a `Date.now()`-seeded initial state would differ between
  // the server render and first client paint (hydration mismatch). Pre-mount the
  // numerals render `00` at `opacity-0` — same DOM, same height on both sides, so
  // there is no mismatch and no layout shift when the real values arrive.
  const [remaining, setRemaining] = useState<ReturnType<typeof timeRemaining> | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(timeRemaining(LAUNCH_AT, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (remaining?.done) {
    return (
      <p className={cn('text-sm font-semibold text-aura', className)}>
        {t('landing.countdown.live', locale)}
      </p>
    );
  }

  // Derived from LAUNCH_AT so the prose date can never drift from the countdown.
  // Rome civil date pinned so SSR and client format identically.
  const date = new Intl.DateTimeFormat(localeTag(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  }).format(LAUNCH_AT);

  const cells = [
    [remaining?.days, t('landing.countdown.days', locale)],
    [remaining?.hours, t('landing.countdown.hours', locale)],
    [remaining?.minutes, t('landing.countdown.minutes', locale)],
    [remaining?.seconds, t('landing.countdown.seconds', locale)],
  ] as const;

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {t('landing.countdown.label', locale, { date })}
      </span>
      <div className="flex gap-5 md:gap-7">
        {cells.map(([value, label]) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                'font-sans text-4xl font-extrabold tabular-nums text-aura md:text-5xl',
                value === undefined && 'opacity-0',
              )}
            >
              {(value ?? 0).toString().padStart(2, '0')}
            </span>
            <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
