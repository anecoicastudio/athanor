import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { Pressable, Text, View, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';

/**
 * A list row (DESIGN §9 «Grouped rows», §8.13; #921): a 17/500 title and an optional second
 * line in 15 grey on the left; on the right a value in 15 grey, a chevron `›`, or a `trailing`
 * control (chips, a `Switch`). At least 60pt tall. `destructive` puts the title in the error
 * red (Esci, Elimina account). It lives inside a `RowGroup`, which gives it the fill, the 16 at
 * each side and the hairline; on its own it has no horizontal padding.
 *
 * `leading` (2026-10-05) is an element drawn before the text, 12 from it by the row's one gap:
 * a member's disc, later a drawn icon. The row does not size it and does not know what it is.
 * It stays at the left at every text size (Marco, that day): at the accessibility sizes the
 * text, the value and the `trailing` control stack beside it. A row that passes none renders
 * no extra node.
 *
 * With `onPress` the whole row is ONE accessible button, named by its title unless the call
 * site passes an `accessibilityLabel`: a row whose second line or tag carries meaning must say
 * them there, and an `Avatar` in its `leading` is `decorative` (#884; `source-audit` holds it).
 * Without `onPress` the row is a plain view: a row that does nothing is not announced as a
 * button, and the control it holds in `trailing` names itself.
 *
 * Nothing here is clipped unless the call site asks: `min-h`, and the value cell shrinks and
 * wraps. `titleLines` and `descriptionLines` are the two clamps, for a row whose text is a
 * member's own (a name, a need): a settings row passes neither. `description` may be an
 * element instead of a string (the dream register's `DreamQuote`), drawn as given.
 * At the accessibility text sizes (`stacksTrailing`, `lib/type-scale.ts`) the value and a
 * `trailing` control move under the text and only the chevron stays at the right, so the text
 * keeps the width and a word is not broken beside them (#847). Seen on 2026-10-04 on the iPhone
 * SE simulator at AX5: beside the text, the value «Abbonamento annuale attivo» broke as
 * «Abbonam / ento»; stacked, it does not, there and on the moto g17 at a font scale of 2.0.
 *
 * Measured that day at the default size: a title-only row is 60 on both devices; with a second
 * line it is 63 (simulator) and 63.2 (phone), which is why the height is a floor.
 */
export function Row({
  title,
  description,
  value,
  onPress,
  destructive = false,
  showChevron = true,
  accessibilityLabel,
  trailing,
  leading,
  titleLines,
  descriptionLines,
}: {
  title: string;
  description?: ReactNode;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  showChevron?: boolean;
  accessibilityLabel?: string;
  trailing?: ReactNode;
  leading?: ReactNode;
  titleLines?: number;
  descriptionLines?: number;
}) {
  // At the accessibility sizes everything but the chevron stacks in one full-width column.
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const chevron =
    showChevron && onPress != null ? (
      <Text className="type-small text-muted-foreground">›</Text>
    ) : null;
  const valueText = (align: string) =>
    value ? <Text className={cn('type-small text-muted-foreground', align)}>{value}</Text> : null;
  const second =
    typeof description === 'string' ? (
      description ? (
        <Text numberOfLines={descriptionLines} className="type-small text-muted-foreground">
          {description}
        </Text>
      ) : null
    ) : (
      (description ?? null)
    );
  const body = (
    <>
      {leading}
      <View className={stacked ? 'flex-1 items-start gap-0.5' : 'flex-1 gap-0.5'}>
        <Text
          numberOfLines={titleLines}
          className={cn('type-body font-medium', destructive ? 'text-error' : 'text-foreground')}
        >
          {title}
        </Text>
        {second}
        {stacked ? valueText('') : null}
        {stacked && trailing != null ? <View className="pt-2">{trailing}</View> : null}
      </View>
      {stacked ? (
        chevron
      ) : value || chevron ? (
        <View className="max-w-[50%] shrink flex-row items-center gap-2">
          {valueText('shrink text-right')}
          {chevron}
        </View>
      ) : null}
      {stacked ? null : trailing}
    </>
  );
  const shape = 'min-h-15 flex-row items-center justify-between gap-3 py-2';

  if (!onPress) return <View className={shape}>{body}</View>;
  return (
    <Pressable
      className={cn(shape, PRESS_DIM)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {body}
    </Pressable>
  );
}
