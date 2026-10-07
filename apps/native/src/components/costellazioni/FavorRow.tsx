import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { FavorNeed, Locale } from '@athanor/schemas';
import { Pressable, View, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Row } from '@/components/Row';

/**
 * One open-need row in the Passa il Favore sheet (DESIGN §8.9, §9 «Grouped rows»; #921): the
 * person's 44 disc, their name on one line, their need on two, and «Aiuta» as the small outline
 * pill. No vanity counts (rule 3), no cyan: offering help is an action, and the celebration is
 * the screen that follows it.
 *
 * The row holds two controls, so it is not a button itself (Marco, 2026-10-07): the disc opens
 * the person's profile (#356) and says so, the pill offers the favour and is named by its
 * visible label. The name and the need are plain text between them. The disc's `Avatar` is
 * `decorative` because the button around it carries the name.
 *
 * The sheet's list is paged, so each row draws its own SEGMENT of the group instead of standing
 * in a `RowGroup` (`feed/Comment`'s recipe, 2026-10-06): `first` rounds the top, `last` the
 * foot, and every row but the first draws the hairline above itself. The list has no gap.
 */
export function FavorRow({
  need,
  locale,
  onHelp,
  busy,
  first = true,
  last = true,
}: {
  need: FavorNeed;
  locale: Locale;
  onHelp: () => void;
  busy: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const router = useRouter();
  const name = memberLabel(need.target_display_name, need.target_handle) ?? '—';
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
            onPress={() => router.push(`/(modal)/user/${need.target_id}`)}
          >
            <Avatar
              decorative
              handle={need.target_handle}
              displayName={need.target_display_name}
              avatarPath={need.target_avatar_path}
              size={44}
            />
          </Pressable>
        }
        title={name}
        titleLines={1}
        description={need.need}
        descriptionLines={2}
        trailing={
          <Button
            variant="outline"
            size="sm"
            label={t('favor.help', locale)}
            loading={busy}
            onPress={onHelp}
          />
        }
      />
    </View>
  );
}
