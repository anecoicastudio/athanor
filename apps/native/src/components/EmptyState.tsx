import type { ReactNode } from 'react';
import { Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { MandorlaMark } from '@/components/MandorlaMark';

/**
 * Empty state per DESIGN §9: the outline mandorla over one line in h2, at most one grey line
 * under it, and at most one action. The action is `Button variant="ghost"`, a foreground text
 * link: an empty state is the quietest block on a screen, not the loudest.
 *
 * `body` is the optional second line several screens have (`*.emptyBody` keys) — a slot, so
 * callers stop string-concatenating keys with newlines.
 *
 * `line="body"` sets the first line in body instead of h2. It is what an ERROR reads as
 * (`ListState`'s error arm): a failed read is a sentence about what went wrong, not the title
 * of an absence.
 */
export function EmptyState({
  children,
  body,
  action,
  line = 'h2',
}: {
  children: ReactNode;
  body?: ReactNode;
  action?: { label: string; onPress: () => void };
  line?: 'h2' | 'body';
}) {
  return (
    <View className="items-center gap-3 py-4">
      <MandorlaMark />
      <Text
        className={
          line === 'h2'
            ? 'mt-1 text-center type-h2 text-foreground'
            : 'mt-1 text-center type-body text-foreground'
        }
      >
        {children}
      </Text>
      {body != null ? (
        <Text className="text-center type-small text-muted-foreground">{body}</Text>
      ) : null}
      {action ? <Button label={action.label} variant="ghost" onPress={action.onPress} /> : null}
    </View>
  );
}
