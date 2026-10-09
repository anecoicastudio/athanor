import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getPublicDreamById, publicDreamKeys } from '@athanor/api';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DreamQuote } from '@/components/DreamQuote';
import { ListState } from '@/components/ListState';
import { LoadingScreen } from '@/components/LoadingScreen';
import { ModalHeader } from '@/components/ModalHeader';
import { Row } from '@/components/Row';
import { RowGroup } from '@/components/RowGroup';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { MilestoneRow } from '@/components/profile/MilestoneRow';
import { useLocale } from '@/hooks/use-locale';
import { supabase } from '@/lib/supabase';
import { wordLines } from '@/lib/word-lines';

/**
 * `/dream/{id}` deep-link viewer (#544) — the native side of the public dream contract
 * (#159, PR #543). AASA + Android intent filters claim the prefix, so an installed app
 * intercepts the link; this screen mirrors `apps/web/components/public-dream-view.tsx`:
 * the dream is the subject (quote leads, in the dream register — Hanken italic here,
 * DESIGN.md §4), the member is a byline linking on to their profile, the tappe follow.
 *
 * Galleria (#921, 2026-10-09; DESIGN §8.12): three blocks 26 apart. The dream is the screen's
 * one bordered card, its label and the quote. The byline is one row of a group: the 44 disc, the
 * name, the handle in grey under it, the chevron. The tappe are a group of `MilestoneRow`s in
 * read mode, as on a profile.
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
 *
 * Its disc is the shared `Avatar` fed through `previewUri`: the read-model hands over a url that
 * is already signed and never a storage key, so there is nothing for `Avatar` to sign, and a url
 * that fails to load falls back to the initial there. The disc is `decorative` because the row
 * says the name: the row is one button, «Apri il profilo di {name}» (#356: never an action with
 * no name).
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
    return <LoadingScreen />;
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
      <Screen>
        <View className="flex-1 items-center justify-center gap-[26px] px-5">
          <Text className="text-center type-body text-muted-foreground">
            {t('publicDream.unavailable', locale)}
          </Text>
          <Button
            variant="outline"
            label={t('notFound.home', locale)}
            onPress={() => router.replace('/(tabs)')}
          />
        </View>
      </Screen>
    );
  }

  const author = dream.author;
  // What the row shows and says: the name they chose, or the handle when they chose none.
  const authorName = author ? (memberLabel(author.displayName, author.handle) ?? '') : '';

  return (
    <Screen>
      <ModalHeader title={t('publicDream.title', locale)} backLabel={t('common.back', locale)} />
      <ScrollView className="flex-1" contentContainerClassName="gap-[26px] px-5 pb-12">
        <Card>
          {author ? (
            <SectionLabel>
              {t('publicDream.titleWithAuthor', locale, { handle: author.handle })}
            </SectionLabel>
          ) : null}
          <DreamQuote text={dream.text} />
        </Card>

        {author ? (
          <RowGroup>
            <Row
              leading={
                <Avatar
                  decorative
                  handle={author.handle}
                  displayName={author.displayName}
                  previewUri={author.avatarUrl ?? null}
                  size={44}
                />
              }
              title={authorName}
              // A lone-word handle ellipsizes (DESIGN §10); the row's label keeps it whole.
              titleLines={wordLines(authorName) === 1 ? 1 : undefined}
              // The handle is the second line only under a chosen name: alone, it is the title.
              description={author.displayName?.trim() ? `@${author.handle}` : undefined}
              descriptionLines={1}
              accessibilityLabel={t('connection.a11y.open', locale, { name: authorName })}
              onPress={() =>
                router.push({ pathname: '/[handle]', params: { handle: `@${author.handle}` } })
              }
            />
          </RowGroup>
        ) : null}

        {dream.milestones.length > 0 ? (
          <RowGroup label={t('publicProfile.milestonesLabel', locale)}>
            {/* Read mode — no handlers, so the row renders glyph + name + state only. */}
            {dream.milestones.map((m) => (
              <MilestoneRow key={m.id} name={m.body} status={m.status} locale={locale} />
            ))}
          </RowGroup>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
