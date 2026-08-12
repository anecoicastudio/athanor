import { ScrollView } from '@/tw';
import type { StoryRailPerson } from '@athanor/api';
import type { Locale } from '@athanor/schemas';
import { StoryRing } from '@/components/stories/StoryRing';

/**
 * The horizontal story rail (frontend §3.1). Your own ring first («Il tuo passo»), then the
 * people with a live story. `seenIds` is UI-only (a watched ring dims). Tapping a ring opens
 * the viewer at that person index; tapping your own ring with no story opens the composer.
 */
export function StoryRail({
  you,
  people,
  seenIds,
  locale,
  onOpenPerson,
  onAddYours,
}: {
  /** The viewer's own handle (the leading ring). */
  you: {
    handle: string | null;
    displayName: string | null;
    avatarPath: string | null;
    hasStory: boolean;
  };
  people: StoryRailPerson[];
  seenIds: Set<string>;
  locale: Locale;
  onOpenPerson: (authorId: string) => void;
  onAddYours: () => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-3 px-5"
    >
      <StoryRing
        handle={you.handle}
        displayName={you.displayName}
        avatarPath={you.avatarPath}
        isYou
        seen={!you.hasStory}
        locale={locale}
        onPress={() => (you.hasStory ? onOpenPerson('me') : onAddYours())}
      />
      {people.map((p) => (
        <StoryRing
          key={p.author_id}
          handle={p.handle}
          displayName={p.display_name}
          avatarPath={p.avatar_path}
          seen={seenIds.has(p.author_id)}
          locale={locale}
          onPress={() => onOpenPerson(p.author_id)}
        />
      ))}
    </ScrollView>
  );
}
