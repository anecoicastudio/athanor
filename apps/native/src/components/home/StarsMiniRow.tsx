import { t } from '@athanor/i18n';
import { STAR_KEYS, type AuraSnapshot, type Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { AuraValue } from '@/components/AuraValue';
import { SectionLabel } from '@/components/SectionLabel';

/**
 * «Le tue stelle» compact row (PRD 01-m1-identity §3.2, block 7). M1 owns the
 * frame; the value + lit flags come read-only from the Aura snapshot (zero for
 * new users until the M6 score-engine fills them — rule #1, never client-written).
 * Tapping the whole row hands off to Profilo where the full Six Stars live.
 */
export function StarsMiniRow({
  snapshot,
  locale,
  onPress,
}: {
  snapshot: AuraSnapshot;
  locale: Locale;
  onPress: () => void;
}) {
  const lit = STAR_KEYS.filter((key) => snapshot.stars[key]).length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.stars.title', locale)}
      onPress={onPress}
      className="gap-3 min-h-[56px] justify-center"
    >
      <View className="flex-row items-center justify-between">
        <SectionLabel>{t('home.stars.title', locale)}</SectionLabel>
        <View className="flex-row items-baseline gap-1">
          <AuraValue value={snapshot.score} size={15} />
          <Text className="text-[11px] font-semibold tracking-[0.1em] text-faint">
            {t('aura.unit', locale)}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <View className="flex-row gap-2">
          {STAR_KEYS.map((key) => (
            <Text
              key={key}
              className={snapshot.stars[key] ? 'text-xl text-aura' : 'text-xl text-faint'}
            >
              {snapshot.stars[key] ? '✦' : '✧'}
            </Text>
          ))}
        </View>
        <Text className="text-[13px] text-faint">{t('home.stars.count', locale, { lit })}</Text>
      </View>
    </Pressable>
  );
}
