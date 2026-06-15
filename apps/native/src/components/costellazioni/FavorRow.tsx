import { t } from '@athanor/i18n';
import type { FavorNeed, Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';

/**
 * One open-need row in the Passa il Favore sheet (frontend `03` §3.6.1): the person's
 * avatar + handle + their need line + an «Aiuta» control. No vanity counts (rule #3).
 * The «Aiuta» control is a flat aura-soft chip — navigation/intent, not a moment, so no
 * glow (rule #4); the one glow is the completion overlay.
 */
export function FavorRow({
  need,
  locale,
  onHelp,
  busy,
}: {
  need: FavorNeed;
  locale: Locale;
  onHelp: () => void;
  busy: boolean;
}) {
  return (
    <View className="flex-row items-center gap-3 rounded-card bg-surface-muted px-4 py-3">
      <Avatar handle={need.target_handle} size={40} />
      <View className="flex-1 gap-0.5">
        <Text className="text-[14px] text-foreground">{need.target_handle ?? '—'}</Text>
        <Text className="text-[13px] text-faint" numberOfLines={2}>
          {need.need}
        </Text>
      </View>
      <Pressable
        onPress={onHelp}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('favor.help', locale)}
        className={`rounded-ctl border border-aura-line bg-aura-soft px-4 py-1.5 ${
          busy ? 'opacity-40' : ''
        }`}
        hitSlop={6}
      >
        <Text className="text-[13px] text-aura">{t('favor.help', locale)}</Text>
      </Pressable>
    </View>
  );
}
