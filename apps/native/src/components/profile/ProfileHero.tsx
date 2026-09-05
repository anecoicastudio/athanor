import { Text, View } from '@/tw';
import { auraGlowLevel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale, ZodiacSign } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { AuraBlock } from './AuraBlock';
import { Mandorla } from '@/components/Mandorla';
import { FoundingBadge } from './FoundingBadge';
import { ZodiacMark } from './ZodiacMark';

export function ProfileHero({
  handle,
  displayName = null,
  avatarPath = null,
  bio,
  auraScore,
  locale,
  auraLabel,
  verified,
  founding,
  zodiacSign = null,
}: {
  handle: string;
  /** Optional name and avatar key (#76). Neither changes what @handle means. */
  displayName?: string | null;
  avatarPath?: string | null;
  bio: string | null;
  /** `null` when the Aura read failed or has not landed — see AuraBlock. */
  auraScore: number | null;
  locale: Locale;
  /** Override the Aura heading for a third-person view (e.g. «la sua Aura»). Defaults to the owner label. */
  auraLabel?: string;
  verified?: boolean;
  founding?: boolean;
  /** Sun sign from the (private) birth date — public, always on, header only (#694). */
  zodiacSign?: ZodiacSign | null;
}) {
  // `memberLabel` would answer «@handle» here, and the hero renders that itself — this line
  // asks the narrower question: did they choose a name?
  const name = displayName?.trim() || null;
  return (
    <View className="items-center gap-3">
      {/* Unknown Aura gets glow level 0: rule #4 reserves the glow for something that happened,
          and a failed read is not an achievement. `auraGlowLevel(0)` is that level. */}
      <Mandorla size={116} glowLevel={auraGlowLevel(auraScore ?? 0)}>
        <Avatar handle={handle} displayName={displayName} avatarPath={avatarPath} size={104} />
      </Mandorla>
      {/* The name leads and the handle follows it, quieter — a member with no name is not
          demoted, their @handle simply keeps the display line it always had (#76). */}
      {/* The sign sits after whichever line leads (#694). `flex-wrap` + `shrink` so 2× Dynamic
          Type wraps the name instead of clipping it; the glyph is SVG at a fixed 20, no `h-[N]`. */}
      {name ? (
        <View className="items-center gap-0.5">
          <View className="flex-row flex-wrap items-center justify-center gap-1.5">
            <Text className="shrink text-center text-[28px] font-bold tracking-[-0.02em] text-foreground">
              {name}
            </Text>
            {zodiacSign ? <ZodiacMark sign={zodiacSign} locale={locale} /> : null}
          </View>
          <Text className="text-[15px] text-ink-2">@{handle}</Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap items-center justify-center gap-1.5">
          <Text className="shrink text-center text-[28px] font-bold tracking-[-0.02em] text-foreground">
            @{handle}
          </Text>
          {zodiacSign ? <ZodiacMark sign={zodiacSign} locale={locale} /> : null}
        </View>
      )}
      {verified ? (
        <Text className="text-xs font-semibold text-aura">
          {t('profile.identityVerified', locale)}
        </Text>
      ) : null}
      {founding ? <FoundingBadge locale={locale} /> : null}
      {bio ? <Text className="text-center text-ink-2">{bio}</Text> : null}
      <AuraBlock score={auraScore} locale={locale} label={auraLabel} />
    </View>
  );
}
