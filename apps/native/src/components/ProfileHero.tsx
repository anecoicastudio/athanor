import { Text, View } from '@/tw';
import { auraGlowLevel } from '@athanor/core';
import type { Locale } from '@athanor/schemas';
import { Avatar } from './Avatar';
import { AuraBlock } from './AuraBlock';
import { Mandorla } from './Mandorla';

export function ProfileHero({
  handle,
  bio,
  auraScore,
  locale,
}: {
  handle: string;
  bio: string | null;
  auraScore: number;
  locale: Locale;
}) {
  return (
    <View className="items-center gap-3">
      <Mandorla size={116} glowLevel={auraGlowLevel(auraScore)}>
        <Avatar handle={handle} size={104} />
      </Mandorla>
      <Text className="text-[28px] font-bold tracking-[-0.02em] text-foreground">@{handle}</Text>
      {bio ? <Text className="text-center text-ink-2">{bio}</Text> : null}
      <AuraBlock score={auraScore} locale={locale} />
    </View>
  );
}
