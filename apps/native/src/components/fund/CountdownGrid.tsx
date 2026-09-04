import { useEffect, useState } from 'react';
import { timeRemaining } from '@athanor/core';
import { t, tn } from '@athanor/i18n';
import { View } from '@/tw';
import { CountdownCell } from './CountdownCell';

/** 4-cell countdown ticking toward a server-authoritative target. Tick is local (Date.now); the deadline is display-only (frontend 07 §5/§9). */
export function CountdownGrid({ targetMs, locale }: { targetMs: number; locale: 'it' | 'en' }) {
  const [rem, setRem] = useState(() => timeRemaining(targetMs, Date.now()));

  useEffect(() => {
    setRem(timeRemaining(targetMs, Date.now()));
    if (timeRemaining(targetMs, Date.now()).done) return;
    const id = setInterval(() => {
      const next = timeRemaining(targetMs, Date.now());
      setRem(next);
      if (next.done) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  // `tn` on days and hours, `t` on minutes and seconds — and that split is the whole of it.
  // Days and hours are words («giorni»/«ore») with a `.one` sibling each (#635 review, #652:
  // without it the Home card said «manca 1 giorno» and this screen said «1 giorni», then «1
  // ore»). Minutes and seconds are the abbreviations «min»/«sec», invariant in both languages
  // and on `i18n.test.ts`'s IDENTICAL_BY_DESIGN allowlist, so they have no `.one` sibling and
  // `tn` would be a promise the catalog does not keep (`t.ts`: adoption is per-key).
  const label = `${rem.days} ${tn('fund.countdown.days', rem.days, locale)}, ${rem.hours} ${tn(
    'fund.countdown.hours',
    rem.hours,
    locale,
  )}, ${rem.minutes} ${t('fund.countdown.minutes', locale)}, ${rem.seconds} ${t(
    'fund.countdown.seconds',
    locale,
  )} — ${t('fund.countdown.label', locale)}`;

  return (
    <View
      className="flex-row gap-2"
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityLiveRegion="none"
    >
      <CountdownCell value={rem.days} unitLabel={tn('fund.countdown.days', rem.days, locale)} />
      <CountdownCell value={rem.hours} unitLabel={tn('fund.countdown.hours', rem.hours, locale)} />
      <CountdownCell value={rem.minutes} unitLabel={t('fund.countdown.minutes', locale)} />
      <CountdownCell value={rem.seconds} unitLabel={t('fund.countdown.seconds', locale)} accent />
    </View>
  );
}
