import { useRouter } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { memberLabel } from '@athanor/core';
import { type Locale, t } from '@athanor/i18n';
import type { ConnectionRequestListItem } from '@athanor/schemas';
import { Pressable, View, cn } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Row } from '@/components/Row';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { wordLines } from '@/lib/word-lines';

/**
 * One incoming request in the Richieste inbox (DESIGN §9 «Grouped rows»; #921): the requester's
 * 44 disc, their name on a line of its own, and under it «Accetta» / «Rifiuta» as two small
 * pills, the white one and the outline one. No cyan: a connection is routine. Both pills are
 * inert while a response is pending.
 *
 * The row holds three controls, so it is not a button itself (Marco, 2026-10-07, the favour
 * row's ruling): the disc opens the requester's profile (#356: vetting a stranger belongs
 * BEFORE accepting) and says so; each pill shows its verb and is spoken with the name, since a
 * list of them would otherwise say «Accetta» once per row. The disc's `Avatar` is `decorative`
 * because the button around it carries the name.
 *
 * The pills stand UNDER the name, not beside it as the canvas draws them (Marco, 2026-10-07):
 * beside them the name had 59.5 of a 303pt row on an iPhone SE simulator and «Alessandra» broke
 * inside the word, the defect #847 fixed once at the accessibility sizes.
 *
 * The inbox is paged, so each row draws its own SEGMENT of the group instead of standing in a
 * `RowGroup` (`feed/Comment`'s recipe, 2026-10-06): `first` rounds the top, `last` the foot, and
 * every row but the first draws the hairline above itself. The list has no gap.
 */
export function ConnectionRequestRow({
  item,
  locale,
  onAccept,
  onDecline,
  pending = false,
  first = true,
  last = true,
}: {
  item: ConnectionRequestListItem;
  locale: Locale;
  onAccept: () => void;
  onDecline: () => void;
  pending?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const router = useRouter();
  const name = memberLabel(item.peerDisplayName, item.peerHandle) ?? '—';
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const pills = (
    <>
      <Button
        size="sm"
        label={t('connection.accept', locale)}
        accessibilityLabel={t('connection.a11y.accept', locale, { name })}
        disabled={pending}
        onPress={onAccept}
      />
      <Button
        variant="outline"
        size="sm"
        label={t('connection.decline', locale)}
        accessibilityLabel={t('connection.a11y.decline', locale, { name })}
        disabled={pending}
        onPress={onDecline}
      />
    </>
  );
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('connection.a11y.open', locale, { name })}
            className={PRESS_DIM}
            onPress={() => router.push(`/(modal)/user/${item.peerId}`)}
          >
            <Avatar
              decorative
              handle={item.peerHandle}
              displayName={item.peerDisplayName}
              avatarPath={item.peerAvatarPath}
              size={44}
            />
          </Pressable>
        }
        title={name}
        // A lone-word handle ellipsizes (DESIGN §10); `connection.a11y.open` keeps it whole.
        titleLines={wordLines(name) === 1 ? 1 : undefined}
        description={
          // The row's second line, 10 under the name. Side by side, and one over the other at
          // the accessibility sizes (8 apart). Never a `ButtonRow`: sized to its content, as
          // this slot sizes it, a wrapping row stood the two pills on each other with no gap
          // (iPhone SE simulator, Expo Go, 2026-10-07).
          <View className={stacked ? 'items-start gap-2 pt-2' : 'flex-row items-center gap-3 pt-2'}>
            {pills}
          </View>
        }
      />
    </View>
  );
}
