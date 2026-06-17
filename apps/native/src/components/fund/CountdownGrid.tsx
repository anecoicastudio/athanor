import { useEffect, useState } from 'react';
import { timeRemaining } from '@athanor/core';
import { t } from '@athanor/i18n';
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

  const label = `${rem.days} ${t('fund.countdown.days', locale)}, ${rem.hours} ${t(
    'fund.countdown.hours',
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
      <CountdownCell value={rem.days} unitLabel={t('fund.countdown.days', locale)} />
      <CountdownCell value={rem.hours} unitLabel={t('fund.countdown.hours', locale)} />
      <CountdownCell value={rem.minutes} unitLabel={t('fund.countdown.minutes', locale)} />
      <CountdownCell value={rem.seconds} unitLabel={t('fund.countdown.seconds', locale)} accent />
    </View>
  );
}
