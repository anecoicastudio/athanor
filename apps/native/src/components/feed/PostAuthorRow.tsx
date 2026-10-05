import { useRouter } from 'expo-router';
import { memberLabel } from '@athanor/core';
import { t } from '@athanor/i18n';
import { Pressable, Text, cn } from '@/tw';
import { PRESS_DIM } from '@/lib/press';
import { wordLines } from '@/lib/word-lines';
import { Avatar } from '@/components/Avatar';
import { useLocale } from '@/hooks/use-locale';
import { useProfile } from '@/hooks/use-profile';

/**
 * Post/comment author identity — the 30pt Avatar and the name, 10 apart, the name in body at
 * 500 as a row's title is (the prototype's `.av.xs` + `.t`). Tap → person detail (M2 read
 * view). The aura-chip NUMBER is deferred to M6 (Aura reads zero pre-engine — no fabricated
 * badge, rule #1/#3).
 *
 * `fill` makes the row take the width its parent leaves and the name fill the row: for a
 * «name left, something right» line, where a name sized to its own words is what Android
 * drew a word short (moto g17, 2026-10-05, seen on Home). Without it the row is as wide as
 * its content and shrinks.
 *
 * A BANNED author renders the tombstone (#314). This row is the reason the ban's read side
 * could not be RLS alone: a banned member's reply STAYS inside someone else's thread by
 * ruling, so something has to label it. Falling back to `memberLabel`'s «·» would say the
 * same thing here as a blocked stranger or a failed read; «Account rimosso» says what
 * actually happened. The identity columns arrive already NULL from `get_person_profile`,
 * so the Avatar degrades to its own initial fallback without being told to.
 *
 * The row is a CONTROL and says so (#635): it had no role at all, so VoiceOver announced a handle
 * and never that tapping it goes anywhere. The label reuses `connection.a11y.open` rather than
 * minting a second «Apri il profilo di {name}» — one sentence, one home, the vocabulary argument
 * `BallotFilterChips` makes for its filter keys.
 *
 * A REMOVED author takes no composed label: «Apri il profilo di Account rimosso» is a sentence
 * about a tombstone. The role stays — the row still navigates — and the children supply the name.
 *
 * Never mount this inside another `Pressable`: on iOS the ancestor is atomic and swallows it, so
 * the profile becomes unreachable (#518). `ProjectCard` used to and no longer does; the shape to
 * copy is `FeedPost`, where the row is a SIBLING of the card's tap target rather than inside it.
 */
export function PostAuthorRow({ authorId, fill = false }: { authorId: string; fill?: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const { data: profile } = useProfile(authorId);
  const handle = profile?.handle ?? null;
  const label = profile?.removed
    ? t('profile.removed.name', locale)
    : memberLabel(profile?.display_name, handle);
  return (
    <Pressable
      // `shrink` on the row and the name (#847): a name wider than what its parent leaves it
      // wraps by word instead of overflowing its block; a lone word ellipsizes (DESIGN §10) and
      // the full name stays on this row's label.
      className={cn('flex-row items-center gap-[10px]', fill ? 'flex-1' : 'shrink', PRESS_DIM)}
      accessibilityRole="button"
      accessibilityLabel={
        profile?.removed || !label ? undefined : t('connection.a11y.open', locale, { name: label })
      }
      onPress={() => router.push(`/(modal)/user/${authorId}`)}
    >
      <Avatar
        decorative
        handle={handle}
        displayName={profile?.display_name ?? null}
        avatarPath={profile?.avatar_path ?? null}
        size={30}
      />
      <Text
        className={cn('type-body font-medium text-foreground', fill ? 'flex-1' : 'shrink')}
        numberOfLines={wordLines(label)}
        // The removed-author row has no label of its own, so the ellipsized name must carry one.
        accessibilityLabel={label ?? undefined}
      >
        {label ?? '·'}
      </Text>
    </Pressable>
  );
}
