import { useLocalSearchParams } from 'expo-router';
import { localeTag, t, type MessageKey } from '@athanor/i18n';
import { starKeySchema } from '@athanor/schemas';
import { ScrollView, Text, View, cn } from '@/tw';
import { BACK_ON_GUTTER, HeaderBack } from '@/components/ModalHeader';
import { ProgressBar } from '@/components/ProgressBar';
import { Tag } from '@/components/Tag';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/hooks/use-locale';
import { useStars } from '@/hooks/use-stars';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import { starsOrNull } from '@/lib/aura-display';
import { starCellState, starGlyph } from '@/lib/star';
import { FONT_SCALE_CAP } from '@/lib/type-scale';
import { wordLines } from '@/lib/word-lines';
import { Screen } from '@/components/Screen';

/**
 * Star detail sheet (M6 §3.2; Galleria, 2026-10-09, #921).
 * Reads the member's OWN `stars` rows from the TanStack cache. The header is the drawn back
 * alone. Blocks 26 apart: the glyph, the
 * name and the state word, centred; the criteria line; then, unearned, {done}/{total} {unit}
 * over a progress bar, or, earned, «Accesa il {date}» formatted like the ledger's short date.
 * The state is the glyph's shape and the word. A lit star is foreground, not cyan (DESIGN
 * §2.3: it is not one of the five marks); unlit and unknown are grey.
 * Rule #1: read-only, no Aura writes.
 */
export default function StarScreen() {
  const { session } = useAuth();
  const locale = useLocale();
  const me = session?.user.id ?? '';
  const back = useGuardedBack();

  const { starId: rawStarId } = useLocalSearchParams<{ starId: string }>();

  // Validate the param — if invalid, nothing meaningful to show.
  const parseResult = starKeySchema.safeParse(rawStarId);
  const starId = parseResult.success ? parseResult.data : null;

  const query = useStars(me);

  // `null` = the read failed. This screen has its own query, so it can fail on its own terms
  // even when the grid that linked here rendered fine — and `?? []` made every star look
  // «spenta», i.e. earned-and-lost-nothing, on a network blip (issue #16). Unknown swaps the
  // glyph and the state word and drops the progress bar; the criteria line stays, because it is
  // static copy about how the star is earned, true whether or not we could read this member's.
  //
  // State via `starCellState` rather than a local `stars == null`, so this screen cannot drift
  // from the grid that links to it — the whole reason that helper exists.
  const stars = starsOrNull(query.data, query.isError);
  const state = starId != null ? starCellState(stars, starId) : 'unknown';
  const unknown = state === 'unknown';
  const row = starId != null ? (stars?.find((s) => s.starId === starId) ?? null) : null;
  const earned = state === 'lit';
  const starName = starId != null ? t(`star.${starId}` as MessageKey, locale) : '';

  const criteriaKey = starId != null ? (`star.criteria.${starId}` as MessageKey) : null;

  // Format grantedAt like the ledger short-date: day + month short, locale-aware.
  const earnedDateStr =
    earned && row?.grantedAt
      ? new Date(row.grantedAt).toLocaleDateString(localeTag(locale), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : null;

  const unit =
    row?.progress.unit != null ? t(`star.unit.${row.progress.unit}` as MessageKey, locale) : '';
  const done = row?.progress.done ?? 0;
  const total = row?.progress.total ?? 0;
  const progressWidth = total > 0 ? done / total : 0;

  return (
    <Screen {...MODAL_A11Y}>
      {/* Header: the back alone, in `ModalHeader`'s own band. `ModalHeader` always renders a
          title, and an empty one was an empty heading before the star's own (seen in the
          simulator's accessibility tree, Expo Go, 2026-10-09). */}
      <View className="flex-row px-5 pb-4 pt-3">
        <HeaderBack className={BACK_ON_GUTTER} label={t('common.back', locale)} onPress={back} />
      </View>

      <ScrollView contentContainerClassName="gap-[26px] px-5 pb-12">
        {starId != null ? (
          <>
            {/* Glyph + name + state word */}
            <View
              className="items-center gap-3"
              accessible={true}
              accessibilityRole="header"
              accessibilityLabel={t(
                unknown ? 'star.a11y.unknown' : earned ? 'star.a11y.lit' : 'star.a11y.unlit',
                locale,
                { star: starName },
              )}
            >
              {/* One glyph, three states, from lib/star.ts. DESIGN §11 (2026-08-08 (c)) named
                  this site as one that had already drifted once. It is an ornament here (the
                  group's label says the state), so it keeps its size at every text size. */}
              <Text
                className={cn('text-[72px]', earned ? 'text-foreground' : 'text-muted-foreground')}
                maxFontSizeMultiplier={FONT_SCALE_CAP.ornament}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {starGlyph(state)}
              </Text>
              {/* The group above is the heading: it says the name and the state as one line,
                  and an element inside an `accessible` view is not reached on its own.
                  A star's name is one word, so it takes one line (DESIGN §10): at the largest
                  text size «Collaboratore» broke as «Collaborat / ore» on an iPhone SE
                  (simulator, Expo Go, 2026-10-09). The group's label keeps the whole name. */}
              <Text
                numberOfLines={wordLines(starName)}
                className="text-center type-h1 text-foreground"
              >
                {starName}
              </Text>
              {/* `earned` is already false when unknown (no rows → no row → no grantedAt), so
                  the quiet branch needs no extra guard — only the WORD changes. */}
              <Tag
                quiet={!earned}
                label={t(unknown ? 'star.unknown' : earned ? 'star.lit' : 'star.unlit', locale)}
              />
            </View>

            {/* Criteria, and the day it was lit */}
            {criteriaKey != null ? (
              <View className="gap-2">
                <Text className="type-body text-foreground">{t(criteriaKey, locale)}</Text>
                {earned && earnedDateStr != null ? (
                  <Text className="type-small text-muted-foreground">
                    {t('star.earnedOn', locale, { date: earnedDateStr })}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Unearned: progress bar */}
            {!earned && row != null ? (
              <View className="gap-2">
                <Text className="type-small text-muted-foreground">
                  {t('star.next.progress', locale, { done, total, unit })}
                </Text>
                <ProgressBar width={progressWidth} />
              </View>
            ) : null}
          </>
        ) : (
          <Text className="text-center type-small text-muted-foreground">
            {t('common.back', locale)}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}
