import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import type { Moment } from '@/types/moment';
import { Pressable, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { MomentAddTile, MomentTile } from '@/components/media/MomentTile';

/**
 * "I tuoi Momenti" — the Profilo gallery section (frontend `01` §3.4 item 6).
 * Header + "Vedi tutti" → full grid; a 3-col gallery of live momenti + the
 * trailing add tile. Media renders from signed URLs (`urls`, path→url); a tile
 * with no URL yet shows the quiet placeholder. Empty for a brand-new user.
 */
export function MomentiGallery({
  moments,
  urls,
  locale,
  onOpen,
  onSeeAll,
  onAdd,
  label,
  emptyLabel,
}: {
  moments: Moment[];
  /** Signed URLs by storage path (from `useSignedUrls('moments', …)`). */
  urls: Record<string, string>;
  locale: Locale;
  onOpen: (index: number) => void;
  onSeeAll: () => void;
  /** Owner add affordance. Omit on a read-only third-person view (no add tile). */
  onAdd?: () => void;
  /** Override the section heading (e.g. «I suoi Momenti»). Defaults to the owner label. */
  label?: string;
  /** Override the empty-state body (e.g. third-person «Ancora nessun Momento»). Defaults to the owner copy. */
  emptyLabel?: string;
}) {
  const empty = moments.length === 0;
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <SectionLabel>{label ?? t('profile.moments.title', locale)}</SectionLabel>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('common.seeAll', locale)}
          hitSlop={8}
          onPress={onSeeAll}
        >
          <Text className="text-[13px] text-aura">{t('common.seeAll', locale)}</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap">
        {moments.map((m, i) => (
          <View key={m.id} className="w-1/3 p-0.5">
            <MomentTile
              moment={m}
              variant="gallery"
              locale={locale}
              url={urls[m.media_path]}
              onPress={() => onOpen(i)}
            />
          </View>
        ))}
        {onAdd ? (
          <View className="w-1/3 p-0.5">
            <MomentAddTile variant="gallery" label={t('moment.add', locale)} onPress={onAdd} />
          </View>
        ) : null}
      </View>

      {empty ? <EmptyState>{emptyLabel ?? t('profile.moments.empty', locale)}</EmptyState> : null}
    </View>
  );
}
