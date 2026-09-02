import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';

/** Avatar diameter. The ring box around it is this plus `border-2` and `p-0.5` — 68. */
const AVATAR = 60;

/**
 * One story-rail entry (frontend §3.1/§4): a ringed Avatar + a name label. An unseen ring is
 * moment-grade (rule #4) → cyan; a seen ring dims. `isYou` shows the «Il tuo passo» label.
 *
 * `onAddPress` renders the always-visible + badge on the own ring (#317, the Instagram
 * add-story pattern) — the only way into the composer while a live story makes the ring tap
 * open the viewer. Flat `bg-raise`/`text-faint` like `MomentAddTile`, NOT cyan: the cyan ring
 * already means «has a live story», and composing isn't itself a moment (rule #4).
 *
 * ## The badge is a SIBLING of the ring, never a descendant (#518)
 *
 * It used to be mounted inside the ring's own Pressable. `Pressable` defaults
 * `accessible={true}`, and on iOS an accessible view is ATOMIC — VoiceOver focuses it as one
 * unit and does not descend — so the badge was unreachable. For a member who already has a
 * live story that is total: the ring tap opens the viewer, the badge is the only way into the
 * composer, and a VoiceOver user could not add a step at all.
 *
 * So the two press targets are siblings under a plain `View`, the `FeedPost.tsx` shape. The
 * badge is positioned against that wrapper instead of against the ring, which is why the
 * insets are spelled out rather than `bottom-0 right-0`: the ring is centred in a wider entry
 * (76 vs 68), and Yoga insets an absolute child by its parent's border and padding, which the
 * wrapper does not have and the ring did. Both numbers below reproduce where the badge painted
 * before — measured against the previous build, not assumed.
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
    <View className="w-[76px] items-center gap-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={onPress}
        hitSlop={HIT_SLOP}
        className="items-center gap-1.5"
      >
        <View className={`rounded-full border-2 p-0.5 ${ring}`}>
          <Avatar handle={handle} displayName={displayName} avatarPath={avatarPath} size={AVATAR} />
        </View>
        <Text
          numberOfLines={1}
          className={`text-[11px] ${seen ? 'text-faint' : 'text-foreground'}`}
        >
          {name}
        </Text>
      </Pressable>
      {onAddPress ? (
        // MEASURED, not derived. `bottom-0 right-0` against the ring put the badge 2px inside
        // the ring box, not 4: Yoga insets an absolute child by the parent's BORDER but not by
        // its padding, so `border-2` counted and `p-0.5` did not. Against this wrapper that is
        // 4 (the ring centred in the wider entry) + 2 = 6 from the right, and
        // 68 - 2 - 20 = 46 from the top. Nothing pins these: the vitest harness is
        // `environment: 'node'` and cannot render a .tsx, so the check is a re-measure in the
        // web build (x=70, y=298 at a 390pt viewport) rather than an assertion.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('story.add.title', locale)}
          // The badge's PAINTED size is fixed by the measurement above, so the 44pt floor
          // (§10) has to come from slop rather than from the box. `h-[20px] w-[20px]`, not
          // `h-5`: a spacing step is 3.5px on device, so `h-5` painted 17.5 there against
          // 20 on web — and 17.5 + 2×11 is 39.5, which is why the shared HIT_SLOP did not
          // actually clear the floor here. 20 + 2×12 = 44 on both platforms.
          hitSlop={12}
          onPress={onAddPress}
          className="absolute right-[6px] top-[46px] h-[20px] w-[20px] items-center justify-center rounded-full border border-hair bg-raise"
        >
          <Text className="text-[13px] leading-[15px] text-faint">+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
