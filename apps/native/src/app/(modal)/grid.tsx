import { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { momentKeys, removeFromBucket, softDeleteMoment } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Moment } from '@/types/moment';
import { useAuth } from '@/lib/auth-context';
import { listState } from '@/lib/list-state';
import { devWarn } from '@/lib/log';
import { momentSignPaths } from '@/lib/media/moment-media';
import { uploadErrorKey } from '@/lib/media/upload';
import { useMomentUpload } from '@/lib/media/use-moment-upload';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { supabase } from '@/lib/supabase';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { Lightbox } from '@/components/media/Lightbox';
import { MediaSheet } from '@/components/media/MediaSheet';
import { MomentAddTile, MomentTile } from '@/components/media/MomentTile';
import { Screen } from '@/components/Screen';
import { useLocale } from '@/hooks/use-locale';
import { useMomentsPage } from '@/hooks/use-moments-page';

/**
 * Full Momenti gallery — the "Vedi tutti" target (frontend `01` §3.5). Owner mode
 * by default; with a `userId` param it renders another member's grid read-only
 * (P3.6: members-read RLS, no add/delete affordances). A self deep-link falls
 * back to owner mode.
 */
export default function GridScreen() {
  const { session } = useAuth();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const locale = useLocale();
  const uid = session?.user?.id;
  const readOnly = Boolean(userId) && userId !== uid;
  const ownerId = readOnly ? (userId as string) : uid;
  const queryClient = useQueryClient();

  // Live momenti (rule #9: keyset). First page (24) only — infinite scroll deferred.
  const momentsQuery = useMomentsPage(ownerId);
  const moments = momentsQuery.data?.moments ?? [];
  // Posters as well as media: the tiles draw a video's poster, the Lightbox plays the video
  // itself, and both read this one map (#131).
  const { urls, isLoading: urlsLoading } = useSignedUrls('moments', momentSignPaths(moments));
  const empty = moments.length === 0;
  // `empty` alone drove the sentence below, so a failed read told the owner their journey
  // starts here and told a visitor this person has no Momenti (#111).
  const gridState = listState({
    status: momentsQuery.status,
    fetchStatus: momentsQuery.fetchStatus,
    isEmpty: empty,
    staleWins: true,
  });

  const [index, setIndex] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addMoment } = useMomentUpload(uid);

  // Long-press a tile → confirm → soft-delete (owner UPDATE policy; no Aura write).
  const confirmDelete = (m: Moment) => {
    Alert.alert(t('moment.delete.title', locale), t('moment.delete.body', locale), [
      { text: t('common.cancel', locale), style: 'cancel' },
      {
        text: t('moment.delete.confirm', locale),
        style: 'destructive',
        onPress: () => {
          softDeleteMoment(supabase, m.id)
            .then(() => {
              // best-effort byte removal (owner storage-delete policy); M9 GDPR job is the backstop.
              // The poster goes with it — it is a second object in the same bucket, and leaving
              // it behind orphans bytes the row no longer points at (#131).
              // Not awaited on purpose — the row is already gone and the grid should not wait
              // on bytes. `removeFromBucket` throws on both failure shapes (a storage-js
              // `{ error }` and a network rejection), so one `.catch` dev-logs each rather than
              // leaving either as an unhandled rejection (#179).
              removeFromBucket(
                supabase,
                'moments',
                m.thumb_path ? [m.media_path, m.thumb_path] : [m.media_path],
              ).catch((e: unknown) => devWarn('[moment] remove bytes', e));
              if (uid) return queryClient.invalidateQueries({ queryKey: momentKeys.list(uid) });
            })
            .catch(() => setError(t('media.failed', locale)));
        },
      },
    ]);
  };

  return (
    <Screen>
      {/* head */}
      <ModalHeader
        title={t(readOnly ? 'profile.moments.theirLabel' : 'moment.gallery.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          readOnly ? undefined : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('moment.add', locale)}
              onPress={() => setSheetOpen(true)}
              // Bare glyph + `hitSlop={8}` measured ~13pt wide. Same box recipe as
              // `HeaderClose`, which sits in this same right slot.
              className="-mr-3 h-[44px] w-[44px] items-center justify-center"
            >
              <Text className="text-2xl text-faint">+</Text>
            </Pressable>
          )
        }
      />

      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-11">
        {readOnly ? null : (
          <Text className="mt-0.5 text-[13px] text-muted-foreground">
            {t('moment.gallery.sub', locale)}
          </Text>
        )}

        {error ? <Text className="mt-2 text-[13px] text-error">{error}</Text> : null}

        <View className="mt-4 flex-row flex-wrap">
          {moments.map((m, i) => (
            <View key={m.id} className="w-1/3 p-0.5">
              <MomentTile
                moment={m}
                variant="full"
                locale={locale}
                urls={urls}
                isLoading={urlsLoading}
                onPress={() => setIndex(i)}
                onLongPress={readOnly ? undefined : () => confirmDelete(m)}
              />
            </View>
          ))}
          {empty && !readOnly ? (
            <View className="w-1/3 p-0.5">
              <MomentAddTile
                variant="full"
                label={t('moment.add', locale)}
                onPress={() => setSheetOpen(true)}
              />
            </View>
          ) : null}
        </View>

        {/* The add tile above stays through every arm for the owner: putting a Momento up does
            not depend on the read that failed. Only the sentence changes. */}
        <ListState
          state={gridState}
          locale={locale}
          errorLabel={t('profile.moments.error', locale)}
          emptyLabel={t(readOnly ? 'profile.moments.theirEmpty' : 'moment.empty', locale)}
          onRetry={() => void momentsQuery.refetch()}
          className="mt-2"
          loading={null}
        />

        <Lightbox
          moments={moments}
          urls={urls}
          urlsLoading={urlsLoading}
          index={index}
          locale={locale}
          onClose={() => setIndex(null)}
          onIndexChange={setIndex}
        />

        {/* «Aggiungi un Momento» — owner only (rule #1: writes only `moments`). Stays
          mounted in owner mode (iOS picker-under-Modal trap — close-then-launch). */}
        {readOnly ? null : (
          <MediaSheet
            visible={sheetOpen}
            allowVideo
            locale={locale}
            onClose={() => setSheetOpen(false)}
            onPick={(m) => addMoment(m).catch((err) => setError(t(uploadErrorKey(err), locale)))}
            onError={(key) => setError(t(key, locale))}
          />
        )}
      </ScrollView>
    </Screen>
  );
}
