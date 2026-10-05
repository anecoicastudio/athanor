import { useWindowDimensions } from 'react-native';
import { Text, View } from '@/tw';
import { t } from '@athanor/i18n';
import type { Locale, ZodiacSign } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { stacksTrailing } from '@/lib/type-scale';
import { AuraBlock } from './AuraBlock';
import { FoundingBadge } from './FoundingBadge';
import { ZodiacMark } from './ZodiacMark';

/**
 * The head of a profile, the member's own and another member's alike: the face beside the name,
 * the bio, the Aura block. Three blocks of the screen, 26 apart like every other (DESIGN §6);
 * 16 between the disc and the name group, 8 inside that group.
 *
 * Nothing here stands for the Aura tier (Marco, 2026-10-03): the disc has no frame and nothing
 * glows. The numeral in `AuraBlock` is the only place the score shows.
 */
export function ProfileHero({
  handle,
  displayName = null,
  avatarPath = null,
  bio,
  city = null,
  auraScore,
  locale,
  auraLabel,
  own,
  verified,
  founding,
  zodiacSign = null,
}: {
  handle: string;
  /** Optional name and avatar key (#76). Neither changes what @handle means. */
  displayName?: string | null;
  avatarPath?: string | null;
  bio: string | null;
  /** Display name of the city, beside the handle. Never the geohash (#149). */
  city?: string | null;
  /** `null` when the Aura read failed or has not landed — see AuraBlock. */
  auraScore: number | null;
  locale: Locale;
  /** Override the Aura heading for a third-person view (e.g. «la sua Aura»). Defaults to the owner label. */
  auraLabel?: string;
  /** The viewer's own profile: the numeral is the cyan mark and the whole Aura row opens `/aura`. */
  own: boolean;
  verified?: boolean;
  founding?: boolean;
  /** Sun sign from the (private) birth date — public, always on, header only (#694). */
  zodiacSign?: ZodiacSign | null;
}) {
  // `memberLabel` would answer «@handle» here, and the hero renders that itself — this line
  // asks the narrower question: did they choose a name?
  const name = displayName?.trim() || null;
  // At the accessibility sizes the disc goes above the name group: beside a 104pt disc the
  // group is too narrow for one long word at twice its size. Same children, same order.
  const stacked = stacksTrailing(useWindowDimensions().fontScale);
  const under = [name ? `@${handle}` : null, city?.trim() || null].filter(Boolean).join(' · ');
  return (
    <>
      <View className={stacked ? 'gap-4' : 'flex-row items-center gap-4'}>
        <Avatar handle={handle} displayName={displayName} avatarPath={avatarPath} size={104} />
        <View className={stacked ? 'gap-2' : 'flex-1 gap-2'}>
          {/* The name leads and the handle follows it, quieter — a member with no name is not
              demoted, their @handle simply keeps the display line it always had (#76). The sign
              sits after whichever line leads (#694); `flex-wrap` + `shrink` so a long name
              wraps instead of clipping, and the glyph is a drawing at a fixed 20. */}
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="shrink type-title text-foreground">{name ?? `@${handle}`}</Text>
            {zodiacSign ? <ZodiacMark sign={zodiacSign} locale={locale} /> : null}
          </View>
          {under ? <Text className="type-small text-muted-foreground">{under}</Text> : null}
          {verified ? (
            <Text className="type-small text-muted-foreground">
              {t('profile.identityVerified', locale)}
            </Text>
          ) : null}
          {founding ? <FoundingBadge locale={locale} /> : null}
        </View>
      </View>
      {bio ? <Text className="type-body text-foreground">{bio}</Text> : null}
      <AuraBlock score={auraScore} locale={locale} label={auraLabel} own={own} />
    </>
  );
}
