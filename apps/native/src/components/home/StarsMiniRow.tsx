import { t } from '@athanor/i18n';
import { STAR_KEYS, type AuraSnapshot, type Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { AuraValue } from '@/components/AuraValue';
import { SectionLabel } from '@/components/SectionLabel';
import { AURA_UNKNOWN } from '@/lib/aura-display';
import { star } from '@/lib/star';

/**
 * «Le tue stelle» compact row (PRD 01-m1-identity §3.2, block 7). M1 owns the
 * frame; the value + lit flags come read-only from the Aura snapshot (zero for
 * new users until the M6 score-engine fills them — rule #1, never client-written).
 * Tapping the whole row hands off to Profilo where the full Six Stars live.
 *
 * `snapshot === null` means we could not read it (loading, disabled, or failed) — the row
 * renders «—» and dark stars with an `aura.unknown` label rather than a confident zero, which
 * on an earned-only reputation would read as «hai guadagnato niente». `text-faint` on the
 * placeholder, never `text-aura`: DESIGN §11 reserves the cyan for a real Aura number.
 */
export function StarsMiniRow({
  snapshot,
  locale,
  onPress,
}: {
  snapshot: AuraSnapshot | null;
  locale: Locale;
  onPress: () => void;
}) {
  const lit = snapshot ? STAR_KEYS.filter((key) => snapshot.stars[key]).length : 0;

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
          {snapshot ? (
            <AuraValue value={snapshot.score} size={15} />
          ) : (
            <Text
              accessibilityLabel={t('aura.unknown', locale)}
              className="text-[15px] font-extrabold text-faint"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {AURA_UNKNOWN}
            </Text>
          )}
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
              className={snapshot?.stars[key] ? 'text-xl text-aura' : 'text-xl text-faint'}
            >
              {star(Boolean(snapshot?.stars[key]))}
            </Text>
          ))}
        </View>
        <Text
          accessibilityLabel={snapshot ? undefined : t('aura.unknown', locale)}
          className="text-[13px] text-faint"
        >
          {snapshot ? t('home.stars.count', locale, { lit }) : AURA_UNKNOWN}
        </Text>
      </View>
    </Pressable>
  );
}
