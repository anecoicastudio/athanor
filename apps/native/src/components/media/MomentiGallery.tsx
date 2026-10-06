import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import type { Moment } from '@/types/moment';
import type { ListState as State } from '@/lib/list-state';
import { useWindowDimensions } from 'react-native';
import { Pressable, Text, View, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';
import { stacksTrailing } from '@/lib/type-scale';
import { ListState } from '@/components/ListState';
import { SectionLabel } from '@/components/SectionLabel';
import { MomentAddTile, MomentTile } from '@/components/media/MomentTile';

/**
 * "I tuoi Momenti" — the Profilo gallery section (frontend `01` §3.4 item 6).
 * Header + "Vedi tutti" → full grid; a 3-col gallery of live momenti + the
 * trailing add tile. Media renders from signed URLs (`urls`, path→url); each tile picks its own
 * path out of the map (a video's poster, a photo's own bytes) and shows the quiet placeholder
 * while there is no URL yet. Empty for a brand-new user.
 *
 * The head is «label left, link right»: the label takes the width that is left and the link is
 * a 44pt underlined one; at the accessibility sizes the link goes under the label. Tiles are
 * three to a row, 6 apart (3 of padding on each, taken back at the grid's edges).
 */
export function MomentiGallery({
  moments,
  urls,
  urlsLoading,
  locale,
  onOpen,
  onSeeAll,
  onAdd,
  label,
  emptyLabel,
  state,
  onRetry,
}: {
  moments: Moment[];
  /** Signed URLs by storage path (from `useSignedUrls('moments', momentSignPaths(…))`). */
  urls: Record<string, string>;
  /** That hook's `isLoading`, passed straight through to each tile — see #135. */
  urlsLoading: boolean;
  locale: Locale;
  onOpen: (index: number) => void;
  onSeeAll: () => void;
  /** Owner add affordance. Omit on a read-only third-person view (no add tile). */
  onAdd?: () => void;
  /** Override the section heading (e.g. «I suoi Momenti»). Defaults to the owner label. */
  label?: string;
  /** Override the empty-state body (e.g. third-person «Ancora nessun Momento»). Defaults to the owner copy. */
  emptyLabel?: string;
  /**
   * `listState(...)` for the query that produced `moments`, from the caller — the gallery is
   * props-driven and cannot see it. Threaded rather than derived because `moments.length === 0`
   * was the whole bug: a failed read told both the owner and a visitor the person has none
   * (#111). Same reason `urlsLoading` is threaded rather than assumed (#135).
   */
  state: State;
  /** `query.refetch()` for that query. */
  onRetry: () => void;
}) {
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  return (
    <View className="gap-2">
      <View
        className={stacked ? 'items-start gap-2' : 'flex-row items-center justify-between gap-3'}
      >
        <SectionLabel className={stacked ? undefined : 'flex-1'}>
          {label ?? t('profile.moments.title', locale)}
        </SectionLabel>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('common.seeAll', locale)}
          className={cn('min-h-[44px] justify-center', PRESS_DIM)}
          onPress={onSeeAll}
        >
          <Text className="type-small text-foreground underline">{t('common.seeAll', locale)}</Text>
        </Pressable>
      </View>

      <View className="-m-[3px] flex-row flex-wrap">
        {moments.map((m, i) => (
          <View key={m.id} className="w-1/3 p-[3px]">
            <MomentTile
              moment={m}
              locale={locale}
              urls={urls}
              isLoading={urlsLoading}
              onPress={() => onOpen(i)}
            />
          </View>
        ))}
        {onAdd ? (
          <View className="w-1/3 p-[3px]">
            <MomentAddTile label={t('moment.add', locale)} onPress={onAdd} />
          </View>
        ) : null}
      </View>

      <ListState
        state={state}
        locale={locale}
        errorLabel={t('profile.moments.error', locale)}
        emptyLabel={emptyLabel ?? t('profile.moments.empty', locale)}
        onRetry={onRetry}
        className=""
        loading={null}
      />
    </View>
  );
}
