import type { ReactNode } from 'react';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';

/**
 * Empty-state motif per DESIGN §9: the ✦ spark glyph (spark vocabulary) over a quiet line
 * of guidance, plus the spec's third element — one ghost action — as an optional slot.
 * Muted so it reads as absence, not a moment: the action is always `Button variant="ghost"`,
 * never a framed cyan pill. Rule #4 does not forbid that pair — with no shadow it is not a glow
 * (§2.3, ruled 2026-09-07) — but an empty state should be the quietest block on a screen, not
 * the loudest.
 *
 * `body` is the optional second line several screens have (`*.emptyBody` keys) — a slot, so
 * callers stop string-concatenating keys with newlines.
 */
export function EmptyState({
  children,
  body,
  action,
}: {
  children: ReactNode;
  body?: ReactNode;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View className="items-center gap-2 py-4">
      <Text
        className="text-2xl text-faint"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        ✦
      </Text>
      <Text className="text-center text-faint">{children}</Text>
      {body != null ? <Text className="text-center text-[13px] text-faint">{body}</Text> : null}
      {action ? (
        <View className="mt-1">
          <Button label={action.label} variant="ghost" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
