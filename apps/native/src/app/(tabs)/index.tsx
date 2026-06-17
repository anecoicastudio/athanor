import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { auraKeys, getAuraEventsSince, getAuraScore } from '@athanor/api';
import { greetingFor, summarizeWeek } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import { type AuraSnapshot, ZERO_AURA_SNAPSHOT } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { WeekCard } from '@/components/aura/WeekCard';
import { ComingSoonSection } from '@/components/home/ComingSoonSection';
import { TodaySection } from '@/components/home/TodaySection';
import { HomeHeader } from '@/components/home/HomeHeader';
import { InviteCard } from '@/components/home/InviteCard';
import { StarsMiniRow } from '@/components/home/StarsMiniRow';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/**
 * Home — the assembly host (PRD 01-m1-identity §3.2). M1 ships the shell + the
 * three blocks that have real data today (greeting, stars-mini → Profilo,
 * invite); the five later-milestone blocks (countdown M7, Esplora Fase2/M8,
 * week M6, nudge M3, Oggi M4) render as honest «Presto qui» placeholders in
 * prototype order and get swapped for the real block when their milestone lands.
 */
export default function HomeScreen() {
  const { profile, session } = useAuth();
  const router = useRouter();
  const [aura, setAura] = useState<AuraSnapshot>(ZERO_AURA_SNAPSHOT);
  const [actionSoon, setActionSoon] = useState(false);

  const userId = session?.user.id ?? '';

  // Read-only Aura snapshot (M1 always zero; M6 score-engine fills real values).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getAuraScore(supabase, userId)
      .then((a) => {
        if (!cancelled) setAura(a);
      })
      .catch(() => {
        // zero-snapshot default is the safe fallback
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Week recap: last 8d of events → summarize client-side. now injected at call site (rule #1).
  const recapQuery = useQuery({
    queryKey: auraKeys.recap(userId),
    queryFn: async () => {
      const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const rows = await getAuraEventsSince(supabase, userId, since);
      return summarizeWeek(rows, new Date());
    },
    enabled: !!userId,
  });

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-2xl text-muted-foreground">✦</Text>
      </View>
    );
  }

  const locale = profile.locale;
  const greeting = t(`home.greeting.${greetingFor(new Date().getHours())}` as MessageKey, locale);

  // `messages` opens the conversations list (M5); search/notifiche land later →
  // honest «Presto qui» hint.
  const onAction = (key: 'search' | 'messages' | 'notifications') => {
    if (key === 'messages') {
      router.push('/messages');
      return;
    }
    setActionSoon(true);
    setTimeout(() => setActionSoon(false), 2000);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-7 px-5 py-12">
      <HomeHeader greeting={greeting} handle={profile.handle} locale={locale} onAction={onAction} />
      {actionSoon ? <Text className="text-[13px] text-faint">{t('home.soon', locale)}</Text> : null}

      {/* Blocks 2–6: honest placeholders until their milestone fills them in. */}
      <ComingSoonSection title={t('home.dream.title', locale)} locale={locale} />
      <ComingSoonSection title={t('home.section.explore', locale)} locale={locale} />
      {recapQuery.data != null ? (
        <WeekCard recap={recapQuery.data} locale={locale} onPress={() => router.push('/recap')} />
      ) : (
        <ComingSoonSection title={t('home.week.title', locale)} locale={locale} />
      )}
      <ComingSoonSection title={t('home.nudge.title', locale)} locale={locale} />
      <TodaySection locale={locale} />

      {/* Block 7: real frame, read-only Aura snapshot → Profilo. */}
      <StarsMiniRow snapshot={aura} locale={locale} onPress={() => router.push('/profile')} />

      {/* Block 8: real invite. */}
      <InviteCard locale={locale} />
    </ScrollView>
  );
}
