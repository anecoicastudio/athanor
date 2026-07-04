import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  blockKeys,
  blockUser,
  getActiveDream,
  getAuraScore,
  getBlockStatus,
  getMomentsPage,
  getOrCreateConversation,
  getProfileById,
  getProfileStatCounts,
  getStars,
  listMilestones,
  listMyHelps,
  momentKeys,
  profileKeys,
  unblockUser,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import {
  type AuraSnapshot,
  type Help,
  type Locale,
  type Milestone,
  type Profile,
  type Star,
  ZERO_AURA_SNAPSHOT,
} from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { ConnectButton } from '@/components/connections/ConnectButton';
import { DreamCard } from '@/components/DreamCard';
import { EmptyState } from '@/components/EmptyState';
import { Lightbox } from '@/components/Lightbox';
import { MomentiGallery } from '@/components/MomentiGallery';
import { ProfileHero } from '@/components/ProfileHero';
import { SectionLabel } from '@/components/SectionLabel';
import { SixStarsGrid } from '@/components/SixStarsGrid';
import { StatLine } from '@/components/StatLine';
import { useSignedUrls } from '@/lib/media/useSignedUrls';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type HelpState = 'available' | 'offered' | 'accepted' | 'completed';

/**
 * Person Detail — read-only third-person profile (M2, frontend `02` §3.5). Mirrors the own
 * Profilo VIEW layout (hero / stat line / six stars / momenti / dream / reviews) but in
 * third person and read-only: the dream card uses `variant="read"` so each tappa offers
 * «Aiuta» → the offer-help sheet. No Aura is ever written here (rule #1); «Connetti»/«Scrivi»
 * are M5 toast stubs; reviews are empty (Fase 3). This is the data contract the web `@handle`
 * page will reuse. No discovery entry point exists in M2 yet — reachable via deep-link for QA.
 */
export default function PersonDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';

  const [person, setPerson] = useState<Profile | null | 'missing'>(null);
  const [dreamText, setDreamText] = useState<string | null>(null);
  const [tappe, setTappe] = useState<Milestone[]>([]);
  const [aura, setAura] = useState<AuraSnapshot>(ZERO_AURA_SNAPSHOT);
  const [stars, setStars] = useState<Star[]>([]);
  const [myHelps, setMyHelps] = useState<Help[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  };

  // Self guard — never double-render the own profile; bounce to the owner tab.
  const isSelf = id != null && id === session?.user?.id;

  const qc = useQueryClient();

  const isBlocked =
    useQuery({
      queryKey: blockKeys.status(id ?? ''),
      queryFn: () => getBlockStatus(supabase, id as string),
      enabled: Boolean(id) && !isSelf,
    }).data ?? false;

  const blockMutation = useMutation({
    mutationFn: () => blockUser(supabase, id as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: blockKeys.all });
      showToast(t('block.toast.blocked', locale));
      router.back();
    },
  });

  const unblockMutation = useMutation({
    mutationFn: () => unblockUser(supabase, id as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: blockKeys.all });
      showToast(t('block.toast.unblocked', locale));
    },
  });

  const openMenu = () => {
    const handle = person != null && person !== 'missing' ? (person.handle ?? '') : '';
    Alert.alert(handle, undefined, [
      isBlocked
        ? { text: t('block.unblock', locale), onPress: () => unblockMutation.mutate() }
        : {
            text: t('block.cta', locale),
            style: 'destructive',
            onPress: () =>
              Alert.alert(t('block.confirm', locale, { name: handle }), undefined, [
                { text: t('common.cancel', locale), style: 'cancel' },
                {
                  text: t('block.cta', locale),
                  style: 'destructive',
                  onPress: () => blockMutation.mutate(),
                },
              ]),
          },
      {
        text: t('report.title', locale),
        onPress: () =>
          router.push({
            pathname: '/(modal)/report',
            params: { targetType: 'person', targetId: id, peerName: handle },
          }),
      },
      { text: t('common.cancel', locale), style: 'cancel' },
    ]);
  };

  // Read-only: the viewed person's live momenti (members-read RLS). No add/delete here.
  const momentsQuery = useQuery({
    queryKey: momentKeys.list(id ?? ''),
    queryFn: () => getMomentsPage(supabase, id as string),
    enabled: Boolean(id) && !isSelf,
  });
  const moments = momentsQuery.data?.moments ?? [];

  // Stat-line counts (collabs completed / events attended) — aggregate-only DEFINER RPC (P3.1).
  const statCounts = useQuery({
    queryKey: profileKeys.statCounts(id ?? ''),
    queryFn: () => getProfileStatCounts(supabase, id as string),
    enabled: Boolean(id) && !isSelf,
    staleTime: 60_000,
  }).data;
  const { urls } = useSignedUrls(
    'moments',
    moments.map((m) => m.media_path),
  );
  useEffect(() => {
    if (isSelf) router.replace('/(tabs)/profile');
  }, [isSelf, router]);

  // Imperative load on mount (mirrors profile.tsx; cancelled-guard).
  useEffect(() => {
    if (isSelf || !id || !session) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getProfileById(supabase, id);
        if (cancelled) return;
        if (!p) {
          setPerson('missing');
          return;
        }
        setPerson(p);
        const d = await getActiveDream(supabase, id);
        if (cancelled) return;
        setDreamText(d?.text ?? null);
        if (d?.id) {
          const ms = await listMilestones(supabase, d.id);
          if (cancelled) return;
          setTappe(ms);
        }
        const a = await getAuraScore(supabase, id);
        if (cancelled) return;
        setAura(a);
        // Earned-only via RLS for others' profiles (rule #3).
        const earnedStars = await getStars(supabase, id);
        if (cancelled) return;
        setStars(earnedStars);
        const helps = await listMyHelps(supabase, session.user.id);
        if (cancelled) return;
        setMyHelps(helps);
      } catch {
        if (!cancelled) setPerson('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isSelf, session]);

  // Refetch my helps on focus so a fresh offer flips the tappa to «In attesa» after the sheet closes.
  useFocusEffect(
    useCallback(() => {
      if (isSelf || !session) return;
      let cancelled = false;
      listMyHelps(supabase, session.user.id)
        .then((helps) => {
          if (!cancelled) setMyHelps(helps);
        })
        .catch(() => {
          // keep the prior helps; the next focus reconciles
        });
      return () => {
        cancelled = true;
      };
    }, [isSelf, session]),
  );

  // Header right slot: share ✦ + kebab ⋯ overflow (shared by the missing + loaded branches).
  const headerRight = (
    <View className="flex-row items-center gap-4">
      <Pressable
        onPress={() => showToast(t('profile.share.toast', locale))}
        accessibilityRole="button"
        accessibilityLabel={t('profile.share.toast', locale)}
        hitSlop={8}
      >
        <Text className="text-xl text-aura">✦</Text>
      </Pressable>
      <Pressable
        onPress={openMenu}
        accessibilityRole="button"
        accessibilityLabel={t('block.cta', locale)}
        hitSlop={8}
      >
        <Text className="text-xl text-foreground">⋯</Text>
      </Pressable>
    </View>
  );

  // Self → already redirecting; render nothing.
  if (isSelf) return null;

  // Loading.
  if (person === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-2xl text-muted-foreground">✦</Text>
      </View>
    );
  }

  // Unavailable / not found.
  if (person === 'missing') {
    return (
      <View className="flex-1 bg-background">
        <ModalHeader title="" backLabel={t('common.back', locale)} right={headerRight} />
        <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-12">
          <EmptyState>{t('profile.unavailable', locale)}</EmptyState>
        </ScrollView>
        {toast ? <Toast label={toast} /> : null}
      </View>
    );
  }

  // Map my prior offers onto each tappa (declined re-opens «Aiuta»).
  const helpStateById = Object.fromEntries(
    tappe.map((m) => {
      const mine = myHelps.find((h) => h.milestone_id === m.id);
      const state: HelpState = mine
        ? mine.status === 'declined'
          ? 'available'
          : mine.status
        : 'available';
      return [m.id, state];
    }),
  ) as Record<string, HelpState>;

  return (
    <View className="flex-1 bg-background">
      <ModalHeader
        title={person.handle ?? ''}
        backLabel={t('common.back', locale)}
        right={headerRight}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-8 px-5 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero: third-person Aura label «la sua Aura» */}
        <ProfileHero
          handle={person.handle ?? ''}
          bio={person.bio ?? null}
          auraScore={aura.score}
          locale={locale}
          auraLabel={t('profile.aura.theirLabel', locale)}
        />

        {/* Stat line — live collabs/events via aggregate-only RPC (P3.1); reviews Fase 3. */}
        <StatLine
          items={[
            {
              value: String(statCounts?.collabsCount ?? 0),
              label: t('profile.stat.collabs', locale),
            },
            { value: String(statCounts?.eventsCount ?? 0), label: t('profile.stat.events', locale) },
            { value: '0', label: t('profile.stat.reviews', locale) },
          ]}
        />

        {/* Le sei stelle — earned-only for others via RLS (rule #3). */}
        <View className="gap-3">
          <SectionLabel>{t('profile.stars.title', locale)}</SectionLabel>
          <SixStarsGrid stars={stars} viewerIsOwner={false} locale={locale} />
        </View>

        {/* I suoi Momenti — live, read-only (members-read RLS); no add affordance. */}
        <MomentiGallery
          moments={moments}
          urls={urls}
          locale={locale}
          onOpen={setLightboxIndex}
          onSeeAll={() => {
            /* M3: their full grid (read-only) — deferred */
          }}
          label={t('profile.moments.theirLabel', locale)}
          emptyLabel={t('profile.moments.theirEmpty', locale)}
        />

        {/* Il suo sogno — read-only, per-tappa «Aiuta». */}
        <DreamCard
          variant="read"
          dream={dreamText}
          locale={locale}
          milestones={tappe}
          helpStateById={helpStateById}
          onHelpMilestone={(milestoneId) => {
            const need = tappe.find((m) => m.id === milestoneId)?.body ?? '';
            router.push({ pathname: '/(modal)/help', params: { milestoneId, need } });
          }}
          onMakeHappen={() => showToast(t('dream.toast.saved', locale))}
        />

        {/* Recensioni umane — Fase 3, no backend. Label only, no vanity count. */}
        <View className="gap-3">
          <SectionLabel>{t('profile.reviews.label', locale)}</SectionLabel>
          <Text className="text-faint">—</Text>
        </View>

        {/* Action bar — «Scrivi» opens-or-creates the conversation; «Connetti» drives the
          full connection-requests state machine (M5). */}
        <View className="flex-row items-center gap-4">
          <View className="flex-1">
            <Button
              label={t('profile.write.cta', locale)}
              variant="ghost"
              onPress={async () => {
                try {
                  const conversationId = await getOrCreateConversation(supabase, id);
                  router.push(`/chat?conversationId=${conversationId}`);
                } catch {
                  showToast(t('chat.openFailed', locale));
                }
              }}
            />
          </View>
          <ConnectButton peerId={id} locale={locale} />
        </View>

        <Lightbox
          moments={moments}
          urls={urls}
          index={lightboxIndex}
          locale={locale}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      </ScrollView>
      {toast ? <Toast label={toast} /> : null}
    </View>
  );
}
