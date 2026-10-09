import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { favorKeys, getOrCreateConversation, passFavor } from '@athanor/api';
import { galleria } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { FavorNeed } from '@athanor/schemas';
import { FlatList, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { HeaderClose, ModalHeader } from '@/components/ModalHeader';
import { CelebrationMark } from '@/components/CelebrationMark';
import { ListState } from '@/components/ListState';
import { FavorRow } from '@/components/costellazioni/FavorRow';
import { SectionLabel } from '@/components/SectionLabel';
import { useLocale } from '@/hooks/use-locale';
import { useOpenNeeds } from '@/hooks/use-open-needs';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { listState } from '@/lib/list-state';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
// A unique violation here means you already passed this favor — treat it as "done".
import { isUniqueViolation } from '@/lib/pg-error';
import { Screen } from '@/components/Screen';

/**
 * Passa il Favore sheet (M3, frontend `03` §3.6.1; DESIGN §8.9). A directed pay-it-forward
 * surface: people with an open need are listed as one group of rows; you help one, asking
 * nothing back. Writes only favor_offers via the api — never Aura (rule #1): the done screen
 * shows NO Aura number; +points / the Collaboratore star are the M6 engine's job. Full-screen
 * modal (the (modal)/* convention), closed from its header.
 *
 * Once a favour is offered the screen becomes the favour-done celebration (DESIGN §2.3,
 * §8.12): one of the five places cyan stands on mobile, and nothing on it glows (#921).
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

  // #633: the write is irreversible — no revoke API exists, and a declined offer is
  // terminal on the unique index. The confirm states that BEFORE the row lands, in
  // words, the way plan-publish and progress-withdraw already do. The Alert is the
  // ballot's precedent for a list surface with no per-row slot for a sentence.
  const confirmHelp = (need: FavorNeed) => {
    Alert.alert(
      t('favor.confirm.title', locale, { name: need.target_handle ?? '—' }),
      t('favor.confirm.body', locale),
      [
        { text: t('common.cancel', locale), style: 'cancel' },
        { text: t('favor.help', locale), onPress: () => void help(need) },
      ],
    );
  };

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
      <Screen {...MODAL_A11Y}>
        {/* A celebration (DESIGN §2.3, §8.12): the mark, one cyan line, the h1, one grey line,
            the cyan pill. No card and no glow, and NO Aura number (rule 1). It scrolls because
            nothing here is capped: at the largest text size the block is taller than a small
            phone. */}
        <ScrollView contentContainerClassName="grow items-center justify-center gap-[26px] px-5 py-12">
          <CelebrationMark />
          <View className="items-center gap-2">
            <SectionLabel tone="celebration">{t('favor.done.eyebrow', locale)}</SectionLabel>
            <Text accessibilityRole="header" className="text-center type-h1 text-foreground">
              {t('favor.done.title', locale, { name })}
            </Text>
            <Text className="text-center type-small text-muted-foreground">
              {t('favor.done.sub', locale)}
            </Text>
          </View>
          <View className="gap-2 self-stretch">
            {writeError ? (
              <Text className="text-center text-[14px] text-error">
                {t('chat.openFailed', locale)}
              </Text>
            ) : null}
            <Button
              label={t('favor.done.write', locale, { name })}
              variant="celebration"
              disabled={writing}
              onPress={() => void write(done)}
            />
            <Button label={t('favor.done.dismiss', locale)} variant="ghost" onPress={leave} />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen {...MODAL_A11Y}>
      <ModalHeader
        leading="none"
        title={t('favor.sheet.title', locale)}
        right={<HeaderClose label={t('common.back', locale)} onPress={leave} />}
      />
      <FlatList
        data={needs}
        keyExtractor={(item) => item.need_milestone_id}
        ListHeaderComponent={
          <View>
            {/* #633: this sentence — the ONLY place the favor's terms are stated — used to
                ride ModalHeader's subtitle, whose one-line contract truncated it mid-word
                («…Nessun…») on every device: 61% of the disclosure was unreachable at any
                scroll position. A header is the one place a disclosure can never live.
                Body paragraph instead, wrapping freely, above the first row. */}
            <Text className="pb-4 type-small text-muted-foreground">
              {t('favor.sheet.sub', locale)}
            </Text>
            {helpError ? (
              <Text className="pb-4 text-[14px] text-error">{t('favor.help.error', locale)}</Text>
            ) : null}
          </View>
        }
        // One group of rows (DESIGN §6): each row draws its own segment, so the list has no gap
        // between items and stays paged.
        renderItem={({ item, index }) => (
          <FavorRow
            need={item}
            locale={locale}
            onHelp={() => confirmHelp(item)}
            busy={helpingId === item.need_milestone_id}
            first={index === 0}
            last={index === needs.length - 1}
          />
        )}
        ListEmptyComponent={
          <ListState
            // `staleWins`: a list. A failed refetch leaves the needs already on screen.
            state={listState({
              status: query.status,
              fetchStatus: query.fetchStatus,
              isEmpty: needs.length === 0,
              staleWins: true,
            })}
            locale={locale}
            errorLabel={t('favor.error', locale)}
            emptyLabel={t('favor.empty.title', locale)}
            emptyBody={t('favor.empty.sub', locale)}
            onRetry={() => void query.refetch()}
            loading={
              <View className="items-center pt-24">
                <ActivityIndicator color={galleria.foregroundMuted} />
              </View>
            }
            className="pt-12"
          />
        }
        // A failed read with rows on screen (a later page, or a refetch): the rows stay, and the
        // reason and its retry stand under them. `ListEmptyComponent` never renders then.
        ListFooterComponent={
          query.isError && needs.length > 0 ? (
            <View className="items-center gap-2 pt-4">
              <Text className="text-center type-small text-muted-foreground">
                {t('favor.error', locale)}
              </Text>
              <Button
                label={t('common.retry', locale)}
                variant="ghost"
                onPress={() =>
                  void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
                }
              />
            </View>
          ) : null
        }
        contentContainerClassName="grow px-5 pb-12"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
      />
    </Screen>
  );
}
