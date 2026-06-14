import { useState } from 'react';
import { useRouter } from 'expo-router';
import { t } from '@auria/i18n';
import { useAuth } from '@/lib/auth-context';
import { MY_MOMENTS } from '@/types/moment';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { EmptyState } from '@/components/EmptyState';
import { Lightbox } from '@/components/Lightbox';
import { MomentAddTile, MomentTile } from '@/components/MomentTile';

/** Full personal Momenti gallery — the "Vedi tutti" target (frontend `01` §3.5). */
export default function GridScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';
  const moments = MY_MOMENTS; // M1 frame-only; M3 → useQuery(momentKeys.list(uid))
  const empty = moments.length === 0;

  const [index, setIndex] = useState<number | null>(null);
  const [soon, setSoon] = useState(false);

  const onAdd = () => {
    // Create/upload is deferred to M3 — surface an honest hint, never fake it.
    setSoon(true);
    setTimeout(() => setSoon(false), 2000);
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
          onPress={onAdd}
        >
          <Text className="text-2xl text-faint">+</Text>
        </Pressable>
      </View>

      <Text className="mt-0.5 text-[12.5px] text-muted-foreground">
        {t('moment.gallery.sub', locale)}
      </Text>

      {soon ? (
        <Text className="mt-2 text-[13px] text-faint">{t('moment.soon', locale)}</Text>
      ) : null}

      <View className="mt-4 flex-row flex-wrap">
        {moments.map((m, i) => (
          <View key={m.id} className="w-1/3 p-0.5">
            <MomentTile moment={m} variant="full" onPress={() => setIndex(i)} />
          </View>
        ))}
        {empty ? (
          <View className="w-1/3 p-0.5">
            <MomentAddTile variant="full" label={t('moment.add', locale)} onPress={onAdd} />
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
        index={index}
        locale={locale}
        onClose={() => setIndex(null)}
        onIndexChange={setIndex}
      />
    </ScrollView>
  );
}
