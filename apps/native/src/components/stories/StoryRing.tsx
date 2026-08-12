import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';

/**
 * One story-rail entry (frontend §3.1/§4): a ringed Avatar + a name label. An unseen ring is
 * moment-grade (rule #4) → cyan; a seen ring dims. `isYou` shows the «Il tuo passo» label.
 */
export function StoryRing({
  handle,
  displayName = null,
  avatarPath = null,
  label,
  seen = false,
  isYou = false,
  locale,
  onPress,
}: {
  handle: string | null;
  /** Optional name and avatar key (#76). */
  displayName?: string | null;
  avatarPath?: string | null;
  /** Name under the ring; defaults to the member's name, then the handle. */
  label?: string;
  seen?: boolean;
  isYou?: boolean;
  locale: Locale;
  onPress: () => void;
}) {
  const ring = seen ? 'border-hair' : 'border-aura';
  const name = isYou
    ? t('story.rail.you', locale)
    : (label ?? memberLabel(displayName, handle) ?? '—');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      hitSlop={HIT_SLOP}
      className="w-[76px] items-center gap-1.5"
    >
      <View className={`rounded-full border-2 p-0.5 ${ring}`}>
        <Avatar handle={handle} displayName={displayName} avatarPath={avatarPath} size={60} />
      </View>
      <Text numberOfLines={1} className={`text-[11px] ${seen ? 'text-faint' : 'text-foreground'}`}>
        {name}
      </Text>
    </Pressable>
  );
}
