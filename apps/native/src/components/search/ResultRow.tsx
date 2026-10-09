import { highlightMatches } from '@athanor/core';
import type { SearchResult } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Row } from '@/components/Row';
import { searchRowLabel } from '@/lib/search-row-label';
import { FONT_SCALE_CAP } from '@/lib/type-scale';
import { wordLines } from '@/lib/word-lines';

/**
 * Search result row (M8 §3.3 / §4 `<ResultRow>`): a `Row` of its section's `RowGroup` since
 * 2026-10-06 (#921), with a 44pt disc before the text and `Row`'s chevron after it.
 *
 * Leading disc:
 *   person  → `<Avatar>` (photo or initials)
 *   project → ◈, event → ◉, in the avatar's own disc (hairline, `surface`): the characters
 *              the prototype draws there. They are Unicode stand-ins, not drawings of the
 *              icon set (`glyphs.tsx` header).
 *
 * The match (Marco, 2026-10-06): the title is the row's, all foreground, with no mark. In the
 * grey second line `highlightMatches` from `@athanor/core` turns the matched spans foreground,
 * which says why a row is here when the match is in its city or category. Colour only: the
 * line does not move as the member types. It was cyan until that day; cyan is five marks on
 * mobile (DESIGN §2.3) and a matched word is not one.
 *
 * The row is one button named by `searchRowLabel`, so the disc says nothing (#884).
 */

function MatchedLine({ text, query }: { text: string; query: string }) {
  const spans = highlightMatches(text, query);
  return (
    <Text className="type-small text-muted-foreground">
      {spans.map((span, i) => (
        <Text key={i} className={span.match ? 'text-foreground' : undefined}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

function EntityIcon({
  entityType,
  title,
  displayName,
  avatarPath,
}: {
  entityType: SearchResult['entity_type'];
  title: string;
  /** Person arm only — NULL on a project or an event (#76). */
  displayName: string | null;
  avatarPath: string | null;
}) {
  if (entityType === 'person') {
    // `title` IS the handle on this arm — the search matched on it, and the row's title is
    // that handle, so the name enters through the avatar rather than replacing the title.
    // Decorative: `searchRowLabel` speaks the name on the row, so the disc does not (#884).
    return (
      <Avatar
        decorative
        handle={title}
        displayName={displayName}
        avatarPath={avatarPath}
        size={44}
      />
    );
  }

  // project → ◈ (diamond with centre dot), event → ◉ (bullseye circle).
  const glyph = entityType === 'project' ? '◈' : '◉';

  return (
    <View className="h-[44px] w-[44px] items-center justify-center rounded-full border border-hair bg-surface">
      {/* `ornament` (DESIGN §10): a decorative mark in a disc whose size is a layout constant.
          The row's label carries the meaning. */}
      <Text
        className="text-[15px] font-semibold text-foreground"
        maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
      >
        {glyph}
      </Text>
    </View>
  );
}

export function ResultRow({
  result,
  query,
  onPress,
}: {
  result: SearchResult;
  query: string;
  onPress: (result: SearchResult) => void;
}) {
  return (
    <Row
      leading={
        <EntityIcon
          entityType={result.entity_type}
          title={result.title}
          displayName={result.display_name}
          avatarPath={result.avatar_path}
        />
      }
      title={result.title}
      // A person's title is a handle, one word: it takes one line and an ellipsis rather than
      // breaking inside the word (DESIGN §10, #754; «marta_cerami / ca» at AX5 on the iPhone
      // SE simulator, 2026-10-06). The row's label says it whole. A title of several words
      // wraps unclamped.
      titleLines={wordLines(result.title) === 1 ? 1 : undefined}
      description={
        result.subtitle ? <MatchedLine text={result.subtitle} query={query} /> : undefined
      }
      onPress={() => onPress(result)}
      accessibilityLabel={searchRowLabel(result)}
    />
  );
}
