import { Text, View } from '@/tw';
import { t, type MessageKey } from '@athanor/i18n';
import { STAR_KEYS, type AuraSnapshot, type Locale } from '@athanor/schemas';

export function SixStarsGrid({ stars, locale }: { stars: AuraSnapshot['stars']; locale: Locale }) {
  return (
    <View className="flex-row flex-wrap">
      {STAR_KEYS.map((key) => {
        const lit = stars[key] ?? false;
        const name = t(`star.${key}` as MessageKey, locale);
        return (
          <View
            key={key}
            className="w-1/3 items-center gap-1.5 py-3"
            accessibilityRole="image"
            accessibilityLabel={`${name} · ${t(lit ? 'star.lit' : 'star.unlit', locale)}`}
          >
            <Text className={lit ? 'text-2xl text-aura' : 'text-2xl text-faint'}>
              {lit ? '✦' : '✧'}
            </Text>
            <Text className="text-[11px] tracking-wide text-faint">{name}</Text>
          </View>
        );
      })}
    </View>
  );
}
