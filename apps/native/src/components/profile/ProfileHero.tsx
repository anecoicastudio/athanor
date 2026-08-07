import { Text, View } from '@/tw';
import { auraGlowLevel } from '@athanor/core';
import { t } from '@athanor/i18n';
import type { Locale } from '@athanor/schemas';
import { Avatar } from '@/components/Avatar';
import { AuraBlock } from './AuraBlock';
import { Mandorla } from '@/components/Mandorla';
import { FoundingBadge } from './FoundingBadge';

export function ProfileHero({
  handle,
  bio,
  auraScore,
  locale,
  auraLabel,
  verified,
  founding,
}: {
  handle: string;
  bio: string | null;
  auraScore: number;
  locale: Locale;
  /** Override the Aura heading for a third-person view (e.g. «la sua Aura»). Defaults to the owner label. */
  auraLabel?: string;
  verified?: boolean;
  founding?: boolean;
}) {
  return (
    <View className="items-center gap-3">
      <Mandorla size={116} glowLevel={auraGlowLevel(auraScore)}>
        <Avatar handle={handle} size={104} />
      </Mandorla>
      <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">@{handle}</Text>
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
