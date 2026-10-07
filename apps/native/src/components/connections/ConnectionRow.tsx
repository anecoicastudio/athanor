import { memberLabel } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { ConnectionListItem } from '@athanor/schemas';
import { View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Row } from '@/components/Row';
import { wordLines } from '@/lib/word-lines';

/**
 * One established connection in the Connessioni list (DESIGN §9 «Grouped rows»; #921): the 44
 * disc and the name, and the whole row is one button. It holds a single action, so unlike a
 * request row it is the control itself. The disc's `Avatar` is `decorative` because the row
 * carries the name.
 *
 * Both lists that render it are paged, so each row draws its own SEGMENT of the group instead
 * of standing in a `RowGroup` (`feed/Comment`'s recipe, 2026-10-06): `first` rounds the top,
 * `last` the foot, and every row but the first draws the hairline above itself. The list has
 * no gap.
 */
export function ConnectionRow({
  item,
  locale,
  onPress,
  first = true,
  last = true,
}: {
  item: ConnectionListItem;
  locale: Locale;
  onPress: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const name = memberLabel(item.peerDisplayName, item.peerHandle) ?? '—';
  return (
    <View
      className={cn(
        'bg-surface px-4',
        first ? 'rounded-t-[28px]' : null,
        last ? 'rounded-b-[28px]' : null,
      )}
    >
      {first ? null : <View className="h-px bg-hair" />}
      <Row
        leading={
          <Avatar
            decorative
            handle={item.peerHandle}
            displayName={item.peerDisplayName}
            avatarPath={item.peerAvatarPath}
            size={44}
          />
        }
        title={name}
        // A lone-word handle ellipsizes (DESIGN §10); the row's label keeps it whole.
        titleLines={wordLines(name) === 1 ? 1 : undefined}
        accessibilityLabel={t('connection.a11y.open', locale, { name })}
        onPress={onPress}
      />
    </View>
  );
}
