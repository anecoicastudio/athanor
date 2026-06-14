import { useState } from 'react';
import { Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { getMomentsPage, momentKeys, softDeleteMoment } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { Moment } from '@/types/moment';
import { useAuth } from '@/lib/auth-context';
import { useMomentUpload } from '@/lib/media/useMomentUpload';
import { useSignedUrls } from '@/lib/media/useSignedUrls';
import { supabase } from '@/lib/supabase';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { Lightbox } from '@/components/Lightbox';
import { MediaSheet } from '@/components/MediaSheet';
import { MomentAddTile, MomentTile } from '@/components/MomentTile';

/** Full personal Momenti gallery — the "Vedi tutti" target (frontend `01` §3.5). */
export default function GridScreen() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const locale = profile?.locale ?? 'it';
  const uid = session?.user?.id;
  const queryClient = useQueryClient();

  // Live own momenti (rule #9: keyset). First page (24) only — infinite scroll deferred.
  const momentsQuery = useQuery({
    queryKey: momentKeys.list(uid ?? ''),
    queryFn: () => getMomentsPage(supabase, uid as string),
    enabled: Boolean(uid),
  });
  const moments = momentsQuery.data?.moments ?? [];
  const { urls } = useSignedUrls(
    'moments',
    moments.map((m) => m.media_path),
  );
  const empty = moments.length === 0;

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
              void supabase.storage.from('moments').remove([m.media_path]);
              if (uid) return queryClient.invalidateQueries({ queryKey: momentKeys.list(uid) });
            })
            .catch(() => setError(t('media.failed', locale)));
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pb-11 pt-12">
      {/* head */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back', locale)}
            hitSlop={8}
            onPress={() => router.back()}
          >
            <Text className="text-2xl text-foreground">‹</Text>
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">
            {t('moment.gallery.title', locale)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('moment.add', locale)}
          hitSlop={8}
          onPress={() => setSheetOpen(true)}
        >
          <Text className="text-2xl text-faint">+</Text>
        </Pressable>
      </View>

      <Text className="mt-0.5 text-[13px] text-muted-foreground">
        {t('moment.gallery.sub', locale)}
      </Text>

      {error ? <Text className="mt-2 text-[13px] text-error">{error}</Text> : null}

      <View className="mt-4 flex-row flex-wrap">
        {moments.map((m, i) => (
          <View key={m.id} className="w-1/3 p-0.5">
            <MomentTile
              moment={m}
              variant="full"
              locale={locale}
              url={urls[m.media_path]}
              onPress={() => setIndex(i)}
              onLongPress={() => confirmDelete(m)}
            />
          </View>
        ))}
        {empty ? (
          <View className="w-1/3 p-0.5">
            <MomentAddTile
              variant="full"
              label={t('moment.add', locale)}
              onPress={() => setSheetOpen(true)}
            />
          </View>
        ) : null}
      </View>

      {empty ? (
        <View className="mt-2">
          <EmptyState>{t('moment.empty', locale)}</EmptyState>
        </View>
      ) : null}

      <Lightbox
        moments={moments}
        urls={urls}
        index={index}
        locale={locale}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
      />

      {/* «Aggiungi un Momento» — real create/upload (rule #1: writes only `moments`). */}
      <MediaSheet
        visible={sheetOpen}
        allowVideo
        locale={locale}
        onClose={() => setSheetOpen(false)}
        onPick={(m) => addMoment(m).catch(() => setError(t('media.failed', locale)))}
      />
    </ScrollView>
  );
}
