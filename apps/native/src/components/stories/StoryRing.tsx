import { memberLabel } from '@athanor/core';
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { AddIcon } from '@/components/glyphs';
import { Pressable, Text, View, cn } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { nameLines } from '@/lib/word-lines';
import { PRESS_DIM } from '@/lib/press';

/** The disc's diameter: `Avatar`'s 56, the prototype's `.av.r`. */
const DISC = 56;
/** The add badge on your own disc while you have a live story. */
const BADGE = 20;

/**
 * One story-rail entry (frontend §3.1/§4): a disc and a name under it, 4 apart.
 *
 * A story to watch is a 2px FOREGROUND ring on the disc, never `aura` (DESIGN §9 «Avatar»,
 * rule 4): the ring is drawn over the disc's own edge, so the disc stays 56 with or without
 * it. A watched story, or no story, leaves the avatar's hairline alone. The name is one grey
 * 11px line pair in every state: the ring carries the state, not the text.
 *
 * Your own entry (`isYou`, «Il tuo passo») has two shapes, and until the caller knows which
 * (`live` is `null` while its read is out) it is your photo with neither add:
 *
 * - no live story (`live` false): the disc holds the drawn `add` and no photo, and its tap is
 *   the caller's `onPress`, which opens the composer. No badge: the disc is the add.
 * - a live story: your photo, ringed until you have watched it, and a small add BADGE on the
 *   disc (#317, the Instagram add-story pattern) — the only way into the composer while the
 *   disc's tap opens the viewer. Foreground on `surface`, not cyan: composing is not a moment.
 *
 * ## The badge is a SIBLING of the disc's button, never a descendant (#518)
 *
 * It used to be mounted inside the disc's own Pressable. `Pressable` defaults
 * `accessible={true}`, and on iOS an accessible view is ATOMIC — VoiceOver focuses it as one
 * unit and does not descend — so the badge was unreachable. For a member who already has a
 * live story that is total: the tap opens the viewer, the badge is the only way into the
 * composer, and a VoiceOver user could not add a step at all.
 *
 * So the two press targets are siblings under a plain `View`, the `FeedPost.tsx` shape, and
 * the badge is positioned against that wrapper: the disc is centred in the 74pt entry, so its
 * box runs from 9 to 65 across and 0 to 56 down, and a 20pt badge in its lower right corner is
 * `right-[9px] top-[36px]`.
 */
export function StoryRing({
  handle,
  displayName = null,
  avatarPath = null,
  label,
  seen = false,
  isYou = false,
  live = null,
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
  /** Own entry only: you have a live story now (see the docblock); `null` = not known yet. */
  live?: boolean | null;
  locale: Locale;
  onPress: () => void;
  /** Own entry only: the add badge's target (the story composer). Drawn while `live`. */
  onAddPress?: () => void;
}) {
  const name = isYou
    ? t('story.rail.you', locale)
    : (label ?? memberLabel(displayName, handle) ?? '—');
  const adds = isYou && live === false;
  return (
    <View className="w-[74px] items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={onPress}
        hitSlop={HIT_SLOP}
        className={cn('items-center gap-1', PRESS_DIM)}
      >
        {adds ? (
          <View
            className="items-center justify-center rounded-full border border-hair bg-surface"
            style={{ width: DISC, height: DISC }}
          >
            <AddIcon color={galleria.foreground} />
          </View>
        ) : (
          <View>
            <Avatar
              decorative
              handle={handle}
              displayName={displayName}
              avatarPath={avatarPath}
              size={DISC}
            />
            {seen ? null : (
              <View
                pointerEvents="none"
                className="absolute inset-0 rounded-full border-2 border-foreground"
              />
            )}
          </View>
        )}
        {/* Two lines (#639), and since #754 two TEXTS: the first word, then the rest, each on
            one line with a tail ellipsis. A single `numberOfLines={2}` broke a long word
            mid-word on iOS («Giovan / ni Rus…») and let a name that fit on one line keep the
            entry a line shorter than its neighbours. Two stacked lines keep every entry the
            same height — and both grow with Dynamic Type (DESIGN §10). A one-word label holds
            the second line with a no-break space, so the box stays even. The Pressable's
            label carries the whole name; the lines are never read on their own. */}
        <View className="w-[74px] items-center">
          {nameLines(name).map((line, i) => (
            <Text key={i} numberOfLines={1} className="text-[11px] text-muted-foreground">
              {line || '\u00a0'}
            </Text>
          ))}
        </View>
      </Pressable>
      {isYou && live === true && onAddPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('story.add.title', locale)}
          // The badge is a 20pt drawing, so the 44pt floor (§10) comes from slop: 20 + 2×12.
          // Its right edge is 9 from the entry's, so 3 of the 12pt right slop falls outside
          // the parent — the region `Input`'s eye-toggle note records Android as declining to
          // deliver. Not measured here.
          hitSlop={12}
          onPress={onAddPress}
          className={cn(
            'absolute right-[9px] top-[36px] items-center justify-center rounded-full border border-hair bg-surface',
            PRESS_DIM,
          )}
          style={{ width: BADGE, height: BADGE }}
        >
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <AddIcon size={12} color={galleria.foreground} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
