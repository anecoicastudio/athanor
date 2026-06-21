import { useState } from 'react';
import { ActivityIndicator, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { type NeedCursor, favorKeys, listOpenNeeds, passFavor } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { FavorNeed, Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FavorRow } from '@/components/costellazioni/FavorRow';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { auraGlow } from '@/lib/glow';
import { MODAL_A11Y } from '@/lib/a11y';

/** A Postgres unique-violation (23505) — you already passed this favor. Treat as "done". */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505'
  );
}

/**
 * Passa il Favore sheet (M3, frontend `03` §3.6.1). A directed pay-it-forward surface:
 * people with an open need are listed; you help one, asking nothing back. Writes only
 * favor_offers via the api — never Aura (rule #1): the completion overlay shows NO Aura
 * number; +points / the Collaboratore star are the M6 engine's job. Full-screen modal
 * (the (modal)/* convention; the Foundation Sheet host lands later).
 */
export default function FavorScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const queryClient = useQueryClient();

  const [helpingId, setHelpingId] = useState<string | null>(null);
  const [done, setDone] = useState<FavorNeed | null>(null);
  const [stubToast, setStubToast] = useState(false);
  const [helpError, setHelpError] = useState(false);

  const query = useInfiniteQuery({
    queryKey: favorKeys.openNeeds,
    queryFn: ({ pageParam }) => listOpenNeeds(supabase, pageParam as NeedCursor | null),
    initialPageParam: null as NeedCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const needs = query.data?.pages.flatMap((p) => p.needs) ?? [];

  const help = async (need: FavorNeed) => {
    if (!session || helpingId) return;
    setHelpError(false);
    setHelpingId(need.need_milestone_id);
    try {
      await passFavor(supabase, session.user.id, {
        target_id: need.target_id,
        need: need.need,
        need_milestone_id: need.need_milestone_id,
      });
      setDone(need);
      void queryClient.invalidateQueries({ queryKey: favorKeys.openNeeds });
    } catch (e) {
      if (isUniqueViolation(e)) {
        setDone(need);
        void queryClient.invalidateQueries({ queryKey: favorKeys.openNeeds });
      } else {
        setHelpError(true);
      }
    } finally {
      setHelpingId(null);
    }
  };

  if (done) {
    const name = done.target_handle ?? '—';
    return (
      <View {...MODAL_A11Y} className="flex-1 items-center justify-center gap-6 bg-background px-8">
        {/* The one glow (rule #4): a favor was lit — a moment. Shows NO Aura number (rule #1). */}
        <View
          className="w-full items-center gap-3 rounded-card border border-aura-line bg-aura-soft px-6 py-10"
          style={auraGlow(1)}
        >
          <Text className="text-[12px] uppercase tracking-wider text-aura">
            {t('favor.done.eyebrow', locale)}
          </Text>
          <Text className="text-center text-2xl text-foreground">
            {t('favor.done.title', locale, { name })}
          </Text>
          <Text className="text-center text-[14px] text-faint">{t('favor.done.sub', locale)}</Text>
        </View>
        {stubToast ? (
          <Text className="text-[13px] text-aura">{t('project.respond.soon', locale)}</Text>
        ) : null}
        <View className="w-full gap-3">
          <Button
            label={t('favor.done.write', locale, { name })}
            variant="light"
            onPress={() => setStubToast(true)}
          />
          <Pressable onPress={() => router.back()} hitSlop={8} className="items-center py-2">
            <Text className="text-[14px] text-faint">{t('favor.done.dismiss', locale)}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View {...MODAL_A11Y} className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <EmptyState>{t('favor.error', locale)}</EmptyState>
        <Pressable
          className="rounded-ctl border border-aura-line bg-aura-soft px-5 py-2"
          onPress={() => void query.refetch()}
        >
          <Text className="text-[13px] text-aura">{t('feed.retry', locale)}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View {...MODAL_A11Y} className="flex-1 bg-background">
      <FlatList
        data={needs}
        keyExtractor={(item) => item.need_milestone_id}
        ListHeaderComponent={
          <View className="gap-3 px-5 pb-2 pt-12">
            <View className="flex-row items-start justify-between">
              <View className="flex-1 gap-1 pr-4">
                <Text accessibilityRole="header" className="text-2xl text-foreground">
                  {t('favor.sheet.title', locale)}
                </Text>
                <Text className="text-[14px] text-faint">{t('favor.sheet.sub', locale)}</Text>
              </View>
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel={t('common.back', locale)}
                hitSlop={8}
              >
                <Text className="text-2xl text-foreground">✕</Text>
              </Pressable>
            </View>
            {helpError ? (
              <Text className="text-[13px] text-error">{t('favor.help.error', locale)}</Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View className="px-5 pb-3">
            <FavorRow
              need={item}
              locale={locale}
              onHelp={() => void help(item)}
              busy={helpingId === item.need_milestone_id}
            />
          </View>
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <View className="items-center justify-center py-24">
              <ActivityIndicator color={semantic.aura} />
            </View>
          ) : (
            <View className="items-center justify-center gap-2 px-8 py-24">
              <EmptyState>{t('favor.empty.title', locale)}</EmptyState>
              <Text className="text-center text-[13px] text-faint">
                {t('favor.empty.sub', locale)}
              </Text>
            </View>
          )
        }
        contentContainerClassName="grow pb-12"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
      />
    </View>
  );
}
