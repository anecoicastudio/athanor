import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { favorKeys, getOrCreateConversation, passFavor } from '@athanor/api';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { FavorNeed } from '@athanor/schemas';
import { FlatList, Pressable, Text, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { Button } from '@/components/Button';
import { HeaderClose, ModalHeader } from '@/components/ModalHeader';
import { EmptyState } from '@/components/EmptyState';
import { ListState } from '@/components/ListState';
import { FavorRow } from '@/components/costellazioni/FavorRow';
import { SectionLabel } from '@/components/SectionLabel';
import { useLocale } from '@/hooks/use-locale';
import { useOpenNeeds } from '@/hooks/use-open-needs';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { auraGlow } from '@/lib/glow';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
// A unique violation here means you already passed this favor — treat it as "done".
import { isUniqueViolation } from '@/lib/pg-error';
import { Screen } from '@/components/Screen';

/**
 * Passa il Favore sheet (M3, frontend `03` §3.6.1). A directed pay-it-forward surface:
 * people with an open need are listed; you help one, asking nothing back. Writes only
 * favor_offers via the api — never Aura (rule #1): the completion overlay shows NO Aura
 * number; +points / the Collaboratore star are the M6 engine's job. Full-screen modal
 * (the (modal)/* convention; the Foundation Sheet host lands later).
 */
export default function FavorScreen() {
  const router = useRouter();
  const leave = useGuardedBack();
  const { session } = useAuth();
  const locale = useLocale();
  const queryClient = useQueryClient();

  const [helpingId, setHelpingId] = useState<string | null>(null);
  const [done, setDone] = useState<FavorNeed | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState(false);
  const [helpError, setHelpError] = useState(false);

  // «Scrivi a {name}» — open-or-create the DM with the helped person (P3.3).
  const write = async (need: FavorNeed) => {
    if (writing) return;
    setWriting(true);
    setWriteError(false);
    try {
      const conversationId = await getOrCreateConversation(supabase, need.target_id);
      router.push(`/chat?conversationId=${conversationId}`);
    } catch {
      setWriteError(true);
    } finally {
      setWriting(false);
    }
  };

  // Shared with Home's FavorNudgeCard — one shape per key (`hooks/use-open-needs`).
  const query = useOpenNeeds();

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
      <Screen {...MODAL_A11Y} className="items-center justify-center gap-6 px-8">
        {/* The one glow (rule #4): a favor was lit — a moment. Shows NO Aura number (rule #1). */}
        <View
          className="w-full items-center gap-3 rounded-card border border-aura-line bg-aura-soft px-6 py-10"
          style={auraGlow(1)}
        >
          <SectionLabel tone="aura">{t('favor.done.eyebrow', locale)}</SectionLabel>
          <Text className="text-center text-2xl text-foreground">
            {t('favor.done.title', locale, { name })}
          </Text>
          <Text className="text-center text-[14px] text-faint">{t('favor.done.sub', locale)}</Text>
        </View>
        {writeError ? (
          <Text className="text-[13px] text-error">{t('chat.openFailed', locale)}</Text>
        ) : null}
        <View className="w-full gap-3">
          <Button
            label={t('favor.done.write', locale, { name })}
            variant="light"
            disabled={writing}
            onPress={() => void write(done)}
          />
          <Pressable onPress={leave} hitSlop={HIT_SLOP} className="items-center py-2">
            <Text className="text-[14px] text-faint">{t('favor.done.dismiss', locale)}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen {...MODAL_A11Y}>
        <ListState
          state="error"
          locale={locale}
          errorLabel={t('favor.error', locale)}
          onRetry={() => void query.refetch()}
          className="flex-1 justify-center px-8"
        />
      </Screen>
    );
  }

  return (
    <Screen {...MODAL_A11Y}>
      <FlatList
        data={needs}
        keyExtractor={(item) => item.need_milestone_id}
        ListHeaderComponent={
          <View>
            <ModalHeader
              leading="none"
              title={t('favor.sheet.title', locale)}
              subtitle={t('favor.sheet.sub', locale)}
              right={<HeaderClose label={t('common.back', locale)} onPress={leave} />}
            />
            {helpError ? (
              <Text className="px-5 pb-2 text-[13px] text-error">
                {t('favor.help.error', locale)}
              </Text>
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
    </Screen>
  );
}
