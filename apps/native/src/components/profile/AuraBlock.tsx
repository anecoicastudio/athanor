import { useRouter } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { Pressable, Text, View, cn } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { SectionLabel } from '@/components/SectionLabel';
import { auraDisplayValue } from '@/lib/aura-display';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';

/**
 * The Aura on a profile: the label and «Come si costruisce ›» on the left, the numeral on the
 * right, on one baseline (the prototype's `.line.sb`, `align-items: flex-end`).
 *
 * The numeral is cyan on the member's OWN profile and foreground on anyone else's: it is one of
 * the five things cyan may mark (DESIGN §2.3), and only as «mine». On the own profile the whole
 * row is one button to `/aura`, named by everything it shows; on another member's the row is
 * inert and the line under the label is the link, foreground and underlined.
 *
 * `score === null` means the read failed or has not landed. It renders «—» in the secondary grey
 * rather than a confident 0, which on an earned-only reputation (PRD §1.1) would claim this
 * person has contributed nothing — and on a third-person profile would claim it about someone
 * else because of the *viewer's* network.
 */
export function AuraBlock({
  score,
  locale,
  label,
  own,
}: {
  score: number | null;
  locale: Locale;
  /** Override the heading (e.g. «la sua Aura» on a read-only person-detail). Defaults to the owner label. */
  label?: string;
  own: boolean;
}) {
  const router = useRouter();
  // The numeral is 44pt and does not shrink: at the accessibility sizes it goes under the label
  // and the link instead of squeezing them, in the order they read.
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const heading = label ?? t('profile.aura.label', locale);
  const how = t('profile.aura.how', locale);
  const unknown = score == null;
  const row = stacked ? 'items-start gap-2' : 'flex-row items-end justify-between gap-3';
  const numeral = (
    <Text
      accessibilityLabel={unknown ? t('aura.unknown', locale) : undefined}
      className={cn(
        'type-num',
        unknown ? 'text-muted-foreground' : own ? 'text-aura' : 'text-foreground',
      )}
    >
      {auraDisplayValue(score, false)}
    </Text>
  );

  if (own) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          heading,
          unknown ? t('aura.unknown', locale) : auraDisplayValue(score, false),
          how,
        ].join(', ')}
        className={cn(row, PRESS_DIM)}
        onPress={() => router.push('/aura')}
      >
        <View className={stacked ? 'gap-2' : 'flex-1 gap-2'}>
          <SectionLabel>{heading}</SectionLabel>
          <Text className="type-small text-muted-foreground">{how}</Text>
        </View>
        {numeral}
      </Pressable>
    );
  }

  return (
    <View className={row}>
      <View className={stacked ? '' : 'flex-1'}>
        <SectionLabel>{heading}</SectionLabel>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={how}
          // A 44pt box around a 21pt line: beside the numeral its slack comes back, so the
          // line sits 8 under the label and on the numeral's foot, as on the own profile.
          className={cn(
            'min-h-[44px] justify-center self-start',
            !stacked && '-mb-3 -mt-1',
            PRESS_DIM,
          )}
          onPress={() => router.push('/aura')}
        >
          <Text className="type-small text-foreground underline">{how}</Text>
        </Pressable>
      </View>
      {numeral}
    </View>
  );
}
