import { useRouter } from 'expo-router';
import { Pressable, Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { SectionLabel } from '@/components/SectionLabel';
import { auraDisplayValue } from '@/lib/aura-display';

/**
 * `score === null` means the read failed or has not landed. It renders «—» in `text-faint`
 * rather than a confident 0, which on an earned-only reputation (PRD §1.1) would claim this
 * person has contributed nothing — and on a third-person profile would claim it about someone
 * else because of the *viewer's* network.
 */
export function AuraBlock({
  score,
  locale,
  label,
}: {
  score: number | null;
  locale: Locale;
  /** Override the heading (e.g. «la sua Aura» on a read-only person-detail). Defaults to the owner label. */
  label?: string;
}) {
  const router = useRouter();
  return (
    <View className="items-center gap-1">
      <SectionLabel>{label ?? t('profile.aura.label', locale)}</SectionLabel>
      <Text
        accessibilityLabel={score == null ? t('aura.unknown', locale) : undefined}
        className={
          score == null
            ? 'text-[44px] font-extrabold tracking-[-0.03em] text-faint'
            : 'text-[44px] font-extrabold tracking-[-0.03em] text-foreground'
        }
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {auraDisplayValue(score, false)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.aura.how', locale)}
        hitSlop={8}
        onPress={() => router.push('/aura')}
      >
        <Text className="text-[13px] text-aura">{t('profile.aura.how', locale)}</Text>
      </Pressable>
    </View>
  );
}
