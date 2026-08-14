import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { FavorNeed, Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';

/**
 * One open-need row in the Passa il Favore sheet (frontend `03` §3.6.1): the person's
 * avatar + handle + their need line + an «Aiuta» control. No vanity counts (rule #3).
 * The «Aiuta» control is a flat aura-soft chip — navigation/intent, not a moment, so no
 * glow (rule #4); the one glow is the completion overlay.
 * The identity block taps through to the person's profile (#356). Its a11y label appends
 * the need line, because the pressable masks child text — without it a screen reader
 * would lose WHAT the person needs.
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
  const router = useRouter();
  const name = memberLabel(need.target_display_name, need.target_handle) ?? '—';
  return (
    <View className="flex-row items-center gap-3 rounded-card bg-surface-muted px-4 py-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('connection.a11y.open', locale, { name })}. ${need.need}`}
        className="flex-1 flex-row items-center gap-3"
        onPress={() => router.push(`/(modal)/user/${need.target_id}`)}
      >
        <Avatar
          handle={need.target_handle}
          displayName={need.target_display_name}
          avatarPath={need.target_avatar_path}
          size={40}
        />
        <View className="flex-1 gap-0.5">
          <Text className="text-[14px] text-foreground">{name}</Text>
          <Text className="text-[13px] text-faint" numberOfLines={2}>
            {need.need}
          </Text>
        </View>
      </Pressable>
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
