import { ScrollView } from '@/tw';
import type { StoryRailPerson } from '@athanor/api';
import type { Locale } from '@athanor/schemas';
import { StoryRing } from '@/components/stories/StoryRing';

/**
 * The horizontal story rail (frontend §3.1). Your own disc first («Il tuo passo»), then the
 * people with a live story. `seenIds` is UI-only (a watched disc loses its ring). Tapping a
 * disc opens the viewer at that person index. With no live story of your own, your disc is the
 * drawn `add` and its tap opens the story composer; with one, the tap opens the viewer and a
 * small add badge on the disc is the only way into the composer (#317).
 *
 * Entries are 74 wide with no gap, and the row starts 11 in: a 56pt disc centred in its entry
 * then stands on the 20pt gutter, 18 from the next disc, with room for a name under it.
 *
 * WHICH of those the own ring's tap does is the caller's call (`onOpenYours`), not this rail's:
 * it depends on a read that may not have answered yet, and only the caller can wait for it
 * (#749 — deciding here off a boolean opened the composer over a live story on a fresh install).
 */
export function StoryRail({
  you,
  people,
  seenIds,
  locale,
  onOpenPerson,
  onOpenYours,
  onAddYours,
}: {
  /** The viewer's own handle (the leading ring). */
  you: {
    handle: string | null;
    displayName: string | null;
    avatarPath: string | null;
    /**
     * Whether you have a live story now: the disc is your photo, and the add moves to a badge.
     * `null` while that is not known yet: your photo, no add, no badge.
     */
    live: boolean | null;
    /** Watched state for the own ring (#298) — the caller derives it; no story reads as seen. */
    seen: boolean;
  };
  people: StoryRailPerson[];
  seenIds: Set<string>;
  locale: Locale;
  onOpenPerson: (authorId: string) => void;
  /** The own ring's tap: your live story, or the composer when there is none. */
  onOpenYours: () => void;
  onAddYours: () => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="px-[11px]"
    >
      <StoryRing
        handle={you.handle}
        displayName={you.displayName}
        avatarPath={you.avatarPath}
        isYou
        live={you.live}
        seen={you.seen}
        locale={locale}
        onPress={onOpenYours}
        onAddPress={onAddYours}
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
