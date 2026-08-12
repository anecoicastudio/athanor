import { useCallback, useEffect, useState } from 'react';
import { Alert, Share } from 'react-native';
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
  listMyHelpsForMilestones,
  momentKeys,
  profileKeys,
  unblockUser,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import type { AuraSnapshot, Help, Locale, Milestone, PersonProfile, Star } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { Toast } from '@/components/Toast';
import { ConnectButton } from '@/components/connections/ConnectButton';
import { DreamCard } from '@/components/profile/DreamCard';
import { EmptyState } from '@/components/EmptyState';
import { Lightbox } from '@/components/media/Lightbox';
import { ProfileBody } from '@/components/profile/ProfileBody';
import { SectionLabel } from '@/components/SectionLabel';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { useAuth } from '@/lib/auth-context';
import { helpableMilestones, type HelpState } from '@/lib/help-picker';
import { profileShareMessage } from '@/lib/profile-share';
import { supabase } from '@/lib/supabase';

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

  const [person, setPerson] = useState<PersonProfile | null | 'missing'>(null);
  const [dreamText, setDreamText] = useState<string | null>(null);
  const [tappe, setTappe] = useState<Milestone[]>([]);
  // `null` until the read lands — a placeholder zero here would claim ANOTHER member has earned
  // nothing, on the strength of the viewer's own connection (issue #10).
  const [aura, setAura] = useState<AuraSnapshot | null>(null);
  // Same contract for the stars, and here it matters most: `[]` would claim ANOTHER member has
  // earned none of the six, on the strength of the viewer's own connection (issue #16).
  const [stars, setStars] = useState<Star[] | null>(null);
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

  // Derived once: the `missing` branch renders the header too, so every consumer of the
  // handle needs the same guard. Two copies of this expression drift the moment
  // PersonProfile grows another sentinel alongside 'missing'.
  const personHandle = person != null && person !== 'missing' ? person.handle : null;

  const openMenu = () => {
    const handle = personHandle ?? '';
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
  const { urls, isLoading: urlsLoading } = useSignedUrls(
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
        let milestoneIds: string[] = [];
        if (d?.id) {
          const ms = await listMilestones(supabase, d.id);
          if (cancelled) return;
          setTappe(ms);
          milestoneIds = ms.map((m) => m.id);
        }
        // Aura + stars fail on their own terms. Folded into the outer catch, a timeout on
        // either one marked the whole PERSON «non disponibile» — and before this branch even
        // reached that catch it had already rendered a zero Aura with six dark stars. Their
        // absence is a `null` snapshot («—»), not a verdict about the profile (issue #10).
        try {
          const a = await getAuraScore(supabase, id);
          if (cancelled) return;
          setAura(a);
          // Earned-only via RLS for others' profiles (rule #3).
          const earnedStars = await getStars(supabase, id);
          if (cancelled) return;
          setStars(earnedStars);
        } catch {
          // aura and stars both stay null — the hero renders «—» rather than a false zero, and
          // the stars block a single «—» rather than a grid asserting nothing was earned.
        }
        // A rejection AFTER unmount lands in that catch rather than a `cancelled` return,
        // so re-check before spending another request.
        if (cancelled) return;
        // Scoped to this dream's tappe: an unscoped page of my newest offers would miss an
        // older one on this dream and render an already-helped tappa as un-helped.
        const { rows: helps } = await listMyHelpsForMilestones(
          supabase,
          session.user.id,
          milestoneIds,
        );
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
      if (isSelf || !session || tappe.length === 0) return;
      let cancelled = false;
      listMyHelpsForMilestones(
        supabase,
        session.user.id,
        tappe.map((m) => m.id),
      )
        .then(({ rows }) => {
          if (!cancelled) setMyHelps(rows);
        })
        .catch(() => {
          // keep the prior helps; the next focus reconciles
        });
      return () => {
        cancelled = true;
      };
    }, [isSelf, session, tappe]),
  );

  // Native share sheet, via the one builder both profile surfaces use. Built at render so
  // the control can be withheld when there is nothing to share — the `missing` branch
  // renders headerRight too, and a button that silently no-ops is the defect #110 is about.
  const shareMessage = profileShareMessage(personHandle, t('app.name', locale));

  const shareProfile = async () => {
    if (!shareMessage) return;
    try {
      await Share.share({ message: shareMessage });
    } catch {
      // user dismissed or share unavailable — no-op
    }
  };

  // Header right slot: share ✦ + kebab ⋯ overflow (shared by the missing + loaded branches).
  const headerRight = (
    <View className="flex-row items-center gap-4">
      {shareMessage != null && (
        <Pressable
          onPress={() => void shareProfile()}
          accessibilityRole="button"
          accessibilityLabel={t('profile.share.toast', locale)}
          hitSlop={8}
        >
          <Text className="text-xl text-aura">✦</Text>
        </Pressable>
      )}
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

  // Map my prior offers onto each tappa. A declined offer stays declined: the
  // (milestone_id, helper_id) unique index has no deleted_at partial, so re-offering is a
  // 23505 the sheet can only report as «Hai già offerto aiuto» — «Aiuta» here would be a
  // dead end, and would disagree with what the picker lists.
  const helpStateById = Object.fromEntries(
    tappe.map((m) => {
      const mine = myHelps.find((h) => h.milestone_id === m.id);
      const state: HelpState = mine ? mine.status : 'available';
      return [m.id, state];
    }),
  ) as Record<string, HelpState>;

  // The rally CTA is withheld when there is nothing left to pick — the picker would open on
  // its own empty state, and a button that leads nowhere is the defect #108 is about.
  const hasHelpableTappa = helpableMilestones(tappe, myHelps).length > 0;

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
        {/* Shared Profilo stack in third person: hero → stat line → stelle → momenti (02 §3.5) */}
        <ProfileBody
          locale={locale}
          hero={{
            handle: person.handle ?? '',
            bio: person.bio ?? null,
            auraScore: aura?.score ?? null,
            locale,
            auraLabel: t('profile.aura.theirLabel', locale),
            founding: person.founding_member,
          }}
          statCounts={statCounts}
          stars={stars}
          viewerIsOwner={false}
          gallery={{
            moments,
            urls,
            urlsLoading,
            locale,
            onOpen: setLightboxIndex,
            onSeeAll: () => router.push({ pathname: '/(modal)/grid', params: { userId: id } }),
            label: t('profile.moments.theirLabel', locale),
            emptyLabel: t('profile.moments.theirEmpty', locale),
          }}
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
          onMakeHappen={
            dreamText != null && hasHelpableTappa
              ? () => router.push({ pathname: '/(modal)/help', params: { userId: id } })
              : undefined
          }
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
          urlsLoading={urlsLoading}
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
