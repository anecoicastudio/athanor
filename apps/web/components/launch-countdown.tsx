'use client';

import { useEffect, useState } from 'react';
import { timeRemaining } from '@athanor/core';
import { t, type Locale } from '@athanor/i18n';
import { cn } from '@/lib/utils';

/**
 * Pre-launch countdown to the public open (11 September 2026). Numbers are the
 * one place cyan numerals are sanctioned on the public landing (DESIGN.md §2/§9);
 * flat `text-aura`, no glow surface (the glow stays for moment-grade events,
 * CLAUDE.md rule 4). Decomposition reuses the tested pure `timeRemaining` from
 * `@athanor/core` — no business logic lives here.
 *
 * Static marketing site has no server clock, so the deadline is a client const;
 * if it slips, edit `LAUNCH_AT` here. Rome is CEST (UTC+2) in September.
 */
const LAUNCH_AT = Date.parse('2026-09-11T00:00:00+02:00');

export function LaunchCountdown({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  // Null until mounted so the server render and first client paint match — a
  // Date.now()-seeded initial state would cause a hydration mismatch.
  const [remaining, setRemaining] = useState<ReturnType<typeof timeRemaining> | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(timeRemaining(LAUNCH_AT, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!remaining) {
    // Reserve vertical space pre-mount; matches the rendered wrapper height.
    return <div className={cn('h-20', className)} aria-hidden />;
  }

  if (remaining.done) {
    return (
      <p className={cn('text-sm font-semibold text-aura', className)}>
        {t('landing.countdown.live', locale)}
      </p>
    );
  }

  const cells = [
    [remaining.days, t('landing.countdown.days', locale)],
    [remaining.hours, t('landing.countdown.hours', locale)],
    [remaining.minutes, t('landing.countdown.minutes', locale)],
    [remaining.seconds, t('landing.countdown.seconds', locale)],
  ] as const;

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {t('landing.countdown.label', locale)}
      </span>
      <div className="flex gap-5 md:gap-7">
        {cells.map(([value, label]) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span className="font-sans text-4xl font-extrabold tabular-nums text-aura md:text-5xl">
              {String(value).padStart(2, '0')}
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
