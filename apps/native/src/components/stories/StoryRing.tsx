import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';

/**
 * One story-rail entry (frontend §3.1/§4): a ringed Avatar + a name label. An unseen ring is
 * moment-grade (rule #4) → cyan; a seen ring dims. `isYou` shows the «Il tuo passo» label.
 *
 * `onAddPress` renders the always-visible + badge on the own ring (#317, the Instagram
 * add-story pattern) — the only way into the composer while a live story makes the ring tap
 * open the viewer. Flat `bg-raise`/`text-faint` like `MomentAddTile`, NOT cyan: the cyan ring
 * already means «has a live story», and composing isn't itself a moment (rule #4).
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
  onAddPress,
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
  /** Own ring only: the + badge target (the story composer). Omit on other people's rings. */
  onAddPress?: () => void;
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
        {onAddPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('story.add.title', locale)}
            hitSlop={HIT_SLOP}
            onPress={onAddPress}
            className="absolute bottom-0 right-0 h-5 w-5 items-center justify-center rounded-full border border-hair bg-raise"
          >
            <Text className="text-[13px] leading-[15px] text-faint">+</Text>
          </Pressable>
        ) : null}
      </View>
      <Text numberOfLines={1} className={`text-[11px] ${seen ? 'text-faint' : 'text-foreground'}`}>
        {name}
      </Text>
    </Pressable>
  );
}
