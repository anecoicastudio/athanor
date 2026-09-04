import { useEffect, useState } from 'react';
import { Alert, Share } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  blockKeys,
  blockUser,
  getBlockStatus,
  getOrCreateConversation,
  getProfileStatCounts,
  profileKeys,
  unblockUser,
} from '@athanor/api';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { LoadingScreen } from '@/components/LoadingScreen';
import { Button } from '@/components/Button';
import { ModalHeader } from '@/components/ModalHeader';
import { useToast } from '@/components/ToastHost';
import { ConnectButton } from '@/components/connections/ConnectButton';
import { DreamCard } from '@/components/profile/DreamCard';
import { EmptyState } from '@/components/EmptyState';
import { Lightbox } from '@/components/media/Lightbox';
import { ProfileBody } from '@/components/profile/ProfileBody';
import { SectionLabel } from '@/components/SectionLabel';
import { momentSignPaths } from '@/lib/media/moment-media';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { useAuth } from '@/lib/auth-context';
import { invalidateBlockDependents } from '@/lib/block-cache';
import { helpableMilestones, type HelpState } from '@/lib/help-picker';
import { listState } from '@/lib/list-state';
import { useGuardedBack } from '@/lib/modal-exit';
import { auraSnapshotOrNull, starsOrNull } from '@/lib/aura-display';
import { profileShareMessage } from '@/lib/profile-share';
import { supabase } from '@/lib/supabase';
import { Screen } from '@/components/Screen';
import { useActiveDream } from '@/hooks/use-active-dream';
import { useAuraScore } from '@/hooks/use-aura-score';
import { useLocale } from '@/hooks/use-locale';
import { useMilestones } from '@/hooks/use-milestones';
import { useMomentsPage } from '@/hooks/use-moments-page';
import { useMyHelpsForDream } from '@/hooks/use-my-helps-for-dream';
import { useProfile } from '@/hooks/use-profile';
import { useStars } from '@/hooks/use-stars';

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
  const { session } = useAuth();
  const locale = useLocale();

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { showToast } = useToast();
  /**
   * `/@handle` reaches this screen through a `replace` (`src/app/[handle].tsx:52`), so on every
   * deep link to a member this screen IS the stack — warm or cold, not only on a cold start.
   * A bare `back()` after blocking would leave the blocker staring at the person they just
   * blocked (#578).
   */
  const leave = useGuardedBack();

  // Self guard — never double-render the own profile; bounce to the owner tab.
  const isSelf = id != null && id === session?.user?.id;
  // One subject for every read on this screen. `null` while the deep link has no id yet, and
  // on the own profile — which is redirecting, and must not spend a request on the way out.
  const personId = isSelf ? null : id;

  const qc = useQueryClient();

  const isBlocked =
    useQuery({
      queryKey: blockKeys.status(personId ?? ''),
      queryFn: () => getBlockStatus(supabase, personId as string),
      enabled: Boolean(personId),
    }).data ?? false;

  // Both also drop the cached profile — this screen's answer changes with the block, and
  // `useProfile` would otherwise hold the old one for five minutes (block-cache.ts has the
  // full story; the «non disponibile» branch carries the kebab the unblock is reached through).
  const blockMutation = useMutation({
    mutationFn: () => blockUser(supabase, id as string),
    onSuccess: () => {
      invalidateBlockDependents(qc, id as string);
      showToast(t('block.toast.blocked', locale), 'success');
      leave();
    },
  });

  const unblockMutation = useMutation({
    mutationFn: () => unblockUser(supabase, id as string),
    onSuccess: () => {
      invalidateBlockDependents(qc, id as string);
      showToast(t('block.toast.unblocked', locale), 'success');
    },
  });

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
  const momentsQuery = useMomentsPage(personId);
  const moments = momentsQuery.data?.moments ?? [];

  // Stat-line counts (collabs completed / events attended) — aggregate-only DEFINER RPC (P3.1).
  const statCounts = useQuery({
    queryKey: profileKeys.statCounts(personId ?? ''),
    queryFn: () => getProfileStatCounts(supabase, personId as string),
    enabled: Boolean(personId),
    staleTime: 60_000,
  }).data;
  // Posters as well as media: the gallery tiles draw a video's poster, the Lightbox plays the
  // video itself, and both read this one map (#131).
  const { urls, isLoading: urlsLoading } = useSignedUrls('moments', momentSignPaths(moments));
  useEffect(() => {
    if (isSelf) router.replace('/(tabs)/profile');
  }, [isSelf, router]);

  // The person, their dream and its tappe — the same three reads the offer-help sheet makes
  // about the same person, so whichever of the two opens second finds them cached. They
  // replace one imperative `useEffect` chain whose `cancelled` flag was hand-rolled cache
  // invalidation; TanStack's own is what the flag was standing in for.
  const personQuery = useProfile(personId);
  const person = personQuery.data ?? null;
  const dreamQuery = useActiveDream(personId);
  const dreamText = dreamQuery.data?.text ?? null;
  const milestonesQuery = useMilestones(dreamQuery.data?.id);
  const tappe = milestonesQuery.data ?? [];

  // Scoped to this dream's tappe: an unscoped page of my newest offers would miss an older one
  // on this dream and render an already-helped tappa as un-helped. The offer sheet invalidates
  // `helpKeys.mine(uid)` when a write lands, so MY OWN new offer settles behind it — which is
  // what the `useFocusEffect` that used to sit here was doing by hand.
  //
  // What that does NOT cover is the dream owner accepting or declining while this screen sits
  // mounted: no invalidation can, since the write happens on their device. RN fires neither
  // `refetchOnWindowFocus` nor `refetchOnReconnect` (nothing wires `focusManager`), and
  // returning from a pushed route does not remount, so a tappa can hold «In attesa» until the
  // screen is popped and re-entered. Realtime on `milestone_helps` is the fix, not a refetch.
  const myHelpsQuery = useMyHelpsForDream(
    session?.user.id,
    dreamQuery.data?.id,
    tappe.map((m) => m.id),
  );
  const myHelps = myHelpsQuery.data?.rows ?? [];

  // The four legs compose into ONE verdict, exactly as the loader's single catch did: any of
  // them failing to LOAD makes the screen «non disponibile». Splitting them would let a failed
  // tappe read render «non ha ancora scritto il suo sogno» — a claim about another member made
  // from the viewer's own broken connection (#111).
  //
  // `isLoadingError`, never `isError`: the latter is also true when a BACKGROUND REFETCH fails
  // over data already in hand, and the helps entry refetches behind the offer sheet on every
  // successful write. A dropped connection at that moment would replace a fully rendered
  // profile with «non disponibile» — something the imperative loader, which ran once at mount,
  // could not do. Stale wins, the same doctrine `lib/list-state.ts` encodes for the lists.
  const personFailed =
    personQuery.isLoadingError ||
    dreamQuery.isLoadingError ||
    milestonesQuery.isLoadingError ||
    myHelpsQuery.isLoadingError;

  // Aura and stars fail on their OWN terms, and did before this too: folded in above, a timeout
  // on either marked the whole person «non disponibile». Their absence is a `null` snapshot
  // («—»), never a verdict about the profile (issues #10, #16). Two queries and not one for the
  // same reason — a live score beside six stars claiming nothing was earned is issue #16.
  const auraQuery = useAuraScore(personId);
  const aura = auraSnapshotOrNull(auraQuery.data, auraQuery.isError);
  // Earned-only via RLS for others' profiles (rule #3).
  const starsQuery = useStars(personId);
  const stars = starsOrNull(starsQuery.data, starsQuery.isError);

  // Derived once: the «non disponibile» branch renders the header too, so every consumer of
  // the handle needs the same guard, and a banned member resolves with `handle` NULL (#314).
  const personHandle = person?.handle ?? null;

  // Native share sheet, via the one builder both profile surfaces use. Built at render so
  // the control can be withheld when there is nothing to share — the `missing` branch
  // renders headerRight too, and a button that silently no-ops is the defect #110 is about.
  const shareMessage = profileShareMessage(personHandle, t('app.name', locale));

  const shareProfile = async () => {
    if (!shareMessage) return;
    try {
      const { action } = await Share.share({ message: shareMessage });
      if (action === Share.sharedAction) {
        showToast(t('profile.share.done', locale), 'success');
      }
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
          accessibilityLabel={t('profile.share.label', locale)}
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

  // Loading — nothing is known about the person yet. A leg that threw is the branch below,
  // so this asks whether the read has settled, not whether there is data.
  if (!personFailed && personQuery.isPending) {
    return <LoadingScreen />;
  }

  // Unavailable / not found.
  if (personFailed || person === null) {
    return (
      <Screen>
        <ModalHeader
          title={t('profile.unavailable.title', locale)}
          backLabel={t('common.back', locale)}
          right={headerRight}
        />
        <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-12">
          <EmptyState>{t('profile.unavailable', locale)}</EmptyState>
        </ScrollView>
      </Screen>
    );
  }

  // Removed — a banned member (#314). Distinct from `missing` above ON PURPOSE: the RPC still
  // RESOLVES a banned member, with every identity column NULL and `removed` true, because zero
  // rows already means «no such person, or blocked». Only one of those answers explains why
  // this person's replies are still sitting in other members' threads, and «non disponibile»
  // is not it. Nothing to share (there is no handle, so the header's share slot withholds
  // itself), no action bar, no dream, no stars — a tombstone offers nothing to do. GDPR erasure
  // (#107) is a different mechanism and never lands here: it deletes the row, so it renders
  // `missing`.
  if (person.removed) {
    return (
      <Screen>
        <ModalHeader
          title={t('profile.removed.title', locale)}
          backLabel={t('common.back', locale)}
        />
        <ScrollView className="flex-1" contentContainerClassName="gap-8 px-5 pb-12">
          <EmptyState>{t('profile.removed.body', locale)}</EmptyState>
        </ScrollView>
      </Screen>
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
    <Screen
      footer={
        /* Action bar — pinned footer (#117), not scroll content: the two things the screen
          exists for stay tappable at any scroll position, and the toast band clears them by
          construction. «Scrivi» opens-or-creates the conversation; «Connetti» drives the
          full connection-requests state machine (M5). */
        <View className="flex-row items-center gap-4 border-t border-hair px-5 pb-3 pt-3">
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
          {/* #640 item 1: when a helpable tappa exists, the pinned action is the product's
              claim — «Fai accadere questo sogno» — not the generic «Connetti» (which stays
              the footer everywhere else; the connect state machine is still reachable from
              a profile with nothing to help). */}
          {dreamText != null && hasHelpableTappa ? (
            <View className="flex-1">
              <Button
                label={t('dream.makeHappenCta', locale)}
                onPress={() => router.push({ pathname: '/(modal)/help', params: { userId: id } })}
              />
            </View>
          ) : (
            <ConnectButton peerId={id} locale={locale} />
          )}
        </View>
      }
    >
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
            displayName: person.display_name,
            avatarPath: person.avatar_path,
            bio: person.bio ?? null,
            auraScore: aura?.score ?? null,
            locale,
            auraLabel: t('profile.aura.theirLabel', locale),
            founding: person.founding_member,
            // #634: the column is selected and granted; only this prop was missing, so a
            // verified member's badge never rendered on their public profile.
            verified: person.identity_verified,
          }}
          statCounts={statCounts}
          dream={
            /* Il suo sogno — read-only, per-tappa «Aiuta»; directly under the hero (#640). */
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
          }
          stars={stars}
          viewerIsOwner={false}
          gallery={{
            moments,
            urls,
            urlsLoading,
            locale,
            // «Ancora nessun Momento» is a claim about ANOTHER member, made on the strength of
            // the viewer's own connection — the same shape #10 fixed for their Aura (#111).
            state: listState({
              status: momentsQuery.status,
              fetchStatus: momentsQuery.fetchStatus,
              isEmpty: moments.length === 0,
              staleWins: true,
            }),
            onRetry: () => void momentsQuery.refetch(),
            onOpen: setLightboxIndex,
            onSeeAll: () => router.push({ pathname: '/(modal)/grid', params: { userId: id } }),
            label: t('profile.moments.theirLabel', locale),
            emptyLabel: t('profile.moments.theirEmpty', locale),
          }}
        />

        {/* Recensioni umane — Fase 3, no backend. A real empty line, no vanity count (#119
          replaced the bare untranslatable «—» that stood here). */}
        <View className="gap-3">
          <SectionLabel>{t('profile.reviews.label', locale)}</SectionLabel>
          <EmptyState>{t('profile.reviews.empty', locale)}</EmptyState>
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
    </Screen>
  );
}
