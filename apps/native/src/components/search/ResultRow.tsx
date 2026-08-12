import { highlightMatches } from '@athanor/core';
import type { SearchResult } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';

/**
 * Search result row (M8 §3.3 / §4 `<ResultRow>`).
 *
 * Leading icon:
 *   person  → `<Avatar>` with gradient + initial (Avatar.tsx pattern)
 *   project → project glyph (◈ — closest from the esoteric 20-glyph set; no SVG
 *              for "costellazioni" yet, so ◈ is a Unicode approximation)
 *   event   → calendar/circle glyph (◉)
 *
 * NOTE — glyph concern: the 20-glyph esoteric SVG set is a Foundation debt
 * (glyphs.tsx comment). For project/event we use Unicode stand-ins (◈ / ◉)
 * in `text-muted-foreground` until the SVG set ships. Task 8/9 can swap them.
 *
 * Highlighted title + subtitle: `highlightMatches` from `@athanor/core` splits
 * the text into matched/unmatched spans. Matched spans → `text-aura` (color only,
 * no motion — rule #4). Unmatched spans → `text-foreground` (title) /
 * `text-muted-foreground` (subtitle).
 *
 * Trailing chevron: `›` in `text-faint`, same pattern as SettingsRow.
 *
 * Min-height ≥44pt for accessibility.
 */

function HighlightedText({
  text,
  query,
  baseClass,
}: {
  text: string;
  query: string;
  baseClass: string;
}) {
  const spans = highlightMatches(text, query);
  return (
    <Text className={baseClass}>
      {spans.map((span, i) => (
        <Text key={i} className={span.match ? 'text-aura' : undefined}>
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
    // `title` IS the handle on this arm — the search matched on it, and the result list keeps
    // highlighting it, so the name enters through the avatar rather than replacing the label.
    return <Avatar handle={title} displayName={displayName} avatarPath={avatarPath} size={40} />;
  }

  // project → ◈ (diamond with centre dot — closest esoteric-set approximation)
  // event   → ◉ (bullseye circle)
  // CONCERN: These are Unicode stand-ins until the full 20-glyph SVG set ships.
  const glyph = entityType === 'project' ? '◈' : '◉';

  return (
    <View
      className="items-center justify-center rounded-full bg-raise-2 border border-hair"
      style={{ width: 40, height: 40 }}
    >
      <Text className="text-[18px] text-muted-foreground">{glyph}</Text>
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
    <Pressable
      className="flex-row items-center gap-3 px-5 py-3"
      style={{ minHeight: 60 }}
      onPress={() => onPress(result)}
      accessibilityRole="button"
      accessibilityLabel={`${result.title}, ${result.subtitle}`}
    >
      {/* Leading icon */}
      <EntityIcon
        entityType={result.entity_type}
        title={result.title}
        displayName={result.display_name}
        avatarPath={result.avatar_path}
      />

      {/* Title + subtitle with highlighted matches */}
      <View className="flex-1 gap-0.5">
        <HighlightedText
          text={result.title}
          query={query}
          baseClass="text-[15px] font-semibold text-foreground"
        />
        {result.subtitle ? (
          <HighlightedText
            text={result.subtitle}
            query={query}
            baseClass="text-[13px] text-muted-foreground"
          />
        ) : null}
      </View>

      {/* Trailing chevron */}
      <Text className="text-base text-faint">›</Text>
    </Pressable>
  );
}
