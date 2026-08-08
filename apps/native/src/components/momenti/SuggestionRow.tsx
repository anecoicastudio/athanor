import { useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import type { Locale, MomentoSuggestion } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { DreamQuote } from '@/components/DreamQuote';
import { Tag } from '@/components/Tag';

/**
 * «Ti potrebbe interessare» curated-lite row (frontend §2) → read-only Person Detail.
 *
 * The trailing marker is a quiet `Tag`, not a cyan pill. This is a DELIBERATE DEVIATION from
 * the ratified prototype (`chip live`, athanor-prototype.html:1391) and frontend spec
 * `05-m5-momenti.md` §70, user-approved 2026-08-08 — not a spec correction, and not a rule-#4
 * fix either: aura-soft/aura-line WITHOUT a shadow is the ordinary accent surface (~50 sites,
 * incl. Chip's selected state), and the glow rule 4 reserves is auraGlow(), which this never had.
 *
 * The reason is affordance: every other cyan aura-soft pill in this app is interactive or
 * stateful (Chip selected, filter tabs, the retry pressable on this same screen), so a static
 * cyan pill inside a Pressable row reads as a control it isn't. `Tag` is the app's static
 * equivalent — IncomingOfferRow uses the identical Avatar + flex-1 + Tag composition.
 * Don't "restore" the cyan without resolving that.
 *
 * It says «Sogno nuovo», not «Alta affinità», because get_momenti_suggestion ranks by the
 * newest active dream and computes no affinity at all — a suggestions table is deferred since
 * M5. Don't restore the affinity wording without a query that earns it.
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
        {/* numberOfLines: Tag is wider than the pill it replaced, and handles run to 30 chars
            (handleSchema) — without this a long one wraps and breaks the min-h-[56px] rhythm. */}
        <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
          {suggestion.handle ?? '—'}
        </Text>
        {suggestion.dreamText ? (
          <DreamQuote compact numberOfLines={1} text={suggestion.dreamText} />
        ) : null}
      </View>
      <Tag label={t('momenti.suggestion.chip', locale)} />
    </Pressable>
  );
}
