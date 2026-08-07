import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import type { Locale, MomentoSuggestion } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';

/**
 * «Ti potrebbe interessare» curated-lite row (frontend §2) → read-only Person Detail.
 * A non-interactive «Alta affinità» pill (aura-soft accent, NOT the interactive Chip
 * toggle) marks the high-affinity peer; the glow stays reserved for a real match (#4).
 */
export function SuggestionRow({
  suggestion,
  locale,
}: {
  suggestion: MomentoSuggestion;
  locale: Locale;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/(modal)/user/${suggestion.candidateId}`)}
      className="min-h-[56px] flex-row items-center gap-3 rounded-card border border-hair bg-raise px-4 py-3"
    >
      <Avatar handle={suggestion.handle} size={48} />
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-foreground">
          {suggestion.handle ?? '—'}
        </Text>
        {suggestion.dreamText ? (
          <DreamQuote compact numberOfLines={1} text={suggestion.dreamText} />
        ) : null}
      </View>
      <View className="rounded-full border border-aura-line bg-aura-soft px-3 py-1.5">
        <Text className="text-[12px] font-semibold text-aura">
          {t('momenti.suggestion.chip', locale)}
        </Text>
      </View>
    </Pressable>
  );
}
