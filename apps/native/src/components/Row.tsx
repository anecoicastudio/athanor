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
 * With `onPress` the whole row is ONE accessible button, named by its title. Without it the row
 * is a plain view: a row that does nothing is not announced as a button, and the control it
 * holds in `trailing` names itself.
 *
 * Nothing here is clipped: `min-h`, no `numberOfLines`, and the value cell shrinks and wraps.
 * At the accessibility text sizes (`stacksTrailing`, `lib/type-scale.ts`) a `trailing` control
 * moves under the text, so the title keeps the full width and a word is not broken beside it
 * (#847).
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
}: {
  title: string;
  description?: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  showChevron?: boolean;
  accessibilityLabel?: string;
  trailing?: ReactNode;
}) {
  const stacked = stacksTrailing(useWindowDimensions().fontScale) && trailing != null;
  const chevron = showChevron && onPress != null;
  const body = (
    <>
      <View className={stacked ? 'gap-0.5 self-stretch' : 'flex-1 gap-0.5'}>
        <Text
          className={cn('type-body font-medium', destructive ? 'text-error' : 'text-foreground')}
        >
          {title}
        </Text>
        {description ? (
          <Text className="type-small text-muted-foreground">{description}</Text>
        ) : null}
      </View>
      {value || chevron ? (
        <View className="max-w-[50%] shrink flex-row items-center gap-2">
          {value ? (
            <Text className="type-small text-muted-foreground shrink text-right">{value}</Text>
          ) : null}
          {chevron ? <Text className="type-small text-muted-foreground">›</Text> : null}
        </View>
      ) : null}
      {trailing}
    </>
  );
  const shape = stacked
    ? 'min-h-15 items-start justify-center gap-[10px] py-[14px]'
    : 'min-h-15 flex-row items-center justify-between gap-3 py-2';

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
