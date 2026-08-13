import { sanctionState } from '@athanor/core';
import { t } from '@athanor/i18n';
import { Text, View } from '@/tw';
import { useAuth } from '@/lib/auth-context';
import { deviceLocale } from '@/lib/locale';
import { longDate } from '@/lib/time';

/**
 * Member-visible sanction banner (#312). Mounted by `Screen`, so it reaches every
 * surface a sanctioned member can still open — the tabs AND the (modal) screens
 * where the active_write_* net (#106/#310) actually denies the write. Members in
 * good standing render nothing. The state re-evaluates per render, so a lapsed
 * suspension clears on the next navigation without a timer.
 */
export function SuspendedNotice() {
  const { profile } = useAuth();
  const sanction = sanctionState(profile, Date.now());
  if (!sanction) return null;
  const locale = profile?.locale ?? deviceLocale;
  const title =
    sanction.kind === 'banned'
      ? t('moderation.banned.title', locale)
      : t('moderation.suspended.title', locale, { date: longDate(sanction.until, locale) });
  const body = t(
    sanction.kind === 'banned' ? 'moderation.banned.body' : 'moderation.suspended.body',
    locale,
  );
  return (
    <View
      accessibilityRole="alert"
      className="mx-5 mt-2 rounded-card border border-error bg-raise px-4 py-3"
    >
      <Text className="text-[13px] font-semibold text-foreground">{title}</Text>
      <Text className="mt-1 text-xs text-muted-foreground">{body}</Text>
    </View>
  );
}
