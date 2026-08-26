import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getPublicDreamById, publicDreamKeys } from '@athanor/api';
import { t } from '@athanor/i18n';
import type { PublicDreamAuthor } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { DreamQuote } from '@/components/DreamQuote';
import { ListState } from '@/components/ListState';
import { ModalHeader } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';

const STATE_KEY = {
  open: 'milestone.state.open',
  in_progress: 'milestone.state.inProgress',
  done: 'milestone.state.done',
} as const;

/**
 * `/dream/{id}` deep-link viewer (#544) — the native side of the public dream contract
 * (#159, PR #543). AASA + Android intent filters claim the prefix, so an installed app
 * intercepts the link; this screen mirrors `apps/web/components/public-dream-view.tsx`:
 * the dream is the subject (quote leads, in the dream register — Hanken italic here,
 * DESIGN.md §4), the member is a byline linking on to their profile, the tappe follow.
 *
 * Same read-model as the web page (`getPublicDreamById`), one deliberate divergence: under
 * the authenticated client `dreams_select_authenticated` gates on `field_visible('dream')`,
 * so a signed-in member also resolves dreams shared at 'members' visibility — dreams the
 * anon web page 404s. That is the in-app contract everywhere else (deck, profile), so the
 * viewer follows it rather than re-imposing the anon gate.
 *
 * The byline navigates via the `[handle]` catcher rather than `(modal)/user/[id]` because
 * the public read-model deliberately carries no profile id — the catcher owns the
 * handle→id resolution and its failure state.
 */
export default function DreamDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();

  const dreamQuery = useQuery({
    queryKey: publicDreamKeys.detail(id),
    queryFn: () => getPublicDreamById(supabase, id),
    enabled: Boolean(id),
  });
  const dream = dreamQuery.data;

  if (dreamQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <Text className="text-2xl text-faint">✦</Text>
      </Screen>
    );
  }
  if (dreamQuery.isError) {
    return (
      <Screen>
        <ModalHeader title={t('publicDream.title', locale)} backLabel={t('common.back', locale)} />
        <ListState
          state="error"
          locale={locale}
          errorLabel={t('publicDream.error', locale)}
          onRetry={() => void dreamQuery.refetch()}
          className="flex-1 justify-center px-5"
        />
      </Screen>
    );
  }
  if (!dream) {
    // Archived, deleted, visibility withdrawn, banned owner — or a non-uuid segment. All one
    // answer, same as the web page: the dream is not available, offer the way home (the link
    // likely arrived from outside, so there may be no stack to go back through).
    return (
      <Screen className="items-center justify-center gap-6 px-8">
        <Text className="text-center text-base text-muted-foreground">
          {t('publicDream.unavailable', locale)}
        </Text>
        <Button
          variant="outline"
          label={t('notFound.home', locale)}
          onPress={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  const author = dream.author;

  return (
    <Screen>
      <ModalHeader title={t('publicDream.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-12 pt-2">
        <View className="gap-6">
          {author ? (
            <SectionLabel tone="aura">
              {t('publicDream.titleWithAuthor', locale, { handle: author.handle })}
            </SectionLabel>
          ) : null}
          <DreamQuote text={dream.text} />
          {author ? (
            <AuthorByline
              author={author}
              label={t('publicDream.authorLink', locale)}
              onPress={() =>
                router.push({ pathname: '/[handle]', params: { handle: `@${author.handle}` } })
              }
            />
          ) : null}
        </View>

        {dream.milestones.length > 0 ? (
          <View className="gap-3">
            <SectionLabel>{t('publicProfile.milestonesLabel', locale)}</SectionLabel>
            <View className="gap-2">
              {dream.milestones.map((m) => (
                <View key={m.id} className="flex-row items-center justify-between gap-4">
                  <Text className="flex-1 text-[15px] text-muted-foreground">{m.body}</Text>
                  <Text
                    className={
                      m.status === 'done'
                        ? 'text-[13px] text-aura'
                        : 'text-[13px] text-muted-foreground'
                    }
                  >
                    {t(STATE_KEY[m.status], locale)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * The web page's byline, on native: photo (already-signed url — the read-model never exposes
 * a storage key, so `Avatar`'s path-signing pipeline does not apply) or the initial, then the
 * names. One pressable block, like the chat identity header — the identity IS the link.
 */
function AuthorByline({
  author,
  label,
  onPress,
}: {
  author: PublicDreamAuthor;
  label: string;
  onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  // A refetch can re-sign the url; give the photo a fresh attempt (same recovery as Avatar).
  useEffect(() => setFailed(false), [author.avatarUrl]);
  const initial = (author.displayName ?? author.handle).trim().charAt(0).toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-3"
    >
      <View
        className="items-center justify-center overflow-hidden rounded-full border border-hair"
        style={{ width: 40, height: 40 }}
      >
        {author.avatarUrl && !failed ? (
          <Image
            source={{ uri: author.avatarUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <Text className="text-lg font-light text-aura">{initial}</Text>
        )}
      </View>
      <View>
        {author.displayName ? (
          <Text className="text-[14px] text-foreground">{author.displayName}</Text>
        ) : null}
        <Text className="text-[14px] tracking-widest text-aura">@{author.handle}</Text>
      </View>
    </Pressable>
  );
}
