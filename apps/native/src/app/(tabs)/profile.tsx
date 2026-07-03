import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  auraKeys,
  confirmHelpComplete,
  getActiveDream,
  getAuraScore,
  getMomentsPage,
  getProfileById,
  getStars,
  listIncomingHelps,
  listMilestones,
  momentKeys,
  respondToHelp,
  softDeleteMilestone,
  starKeys,
  updateMilestoneStatus,
  updateProfile,
} from '@athanor/api';
import { IDENTITY_TAGS, pickNextStar, profileCompleteness, SEEKING_TAGS } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import {
  type AuraSnapshot,
  type Help,
  type Milestone,
  ZERO_AURA_SNAPSHOT,
  type Locale,
  type Profile,
  type StarKey,
} from '@athanor/schemas';
import { Share } from 'react-native';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { HIT_SLOP } from '@/lib/a11y';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DreamCard } from '@/components/DreamCard';
import { IncomingOfferRow } from '@/components/IncomingOfferRow';
import { MomentFlash } from '@/components/MomentFlash';
import { ProfileHero } from '@/components/ProfileHero';
import { SectionLabel } from '@/components/SectionLabel';
import { SettingsRow } from '@/components/SettingsRow';
import { SixStarsGrid } from '@/components/SixStarsGrid';
import { Toast } from '@/components/Toast';
import { StarProgress } from '@/components/aura/StarProgress';
import { Lightbox } from '@/components/Lightbox';
import { MediaSheet } from '@/components/MediaSheet';
import { MomentiGallery } from '@/components/MomentiGallery';
import { StatLine } from '@/components/StatLine';
import { Tag } from '@/components/Tag';
import { useMomentUpload } from '@/lib/media/useMomentUpload';
import { useSignedUrls } from '@/lib/media/useSignedUrls';
import { useAuth } from '@/lib/auth-context';
import { useAuraRealtime } from '@/lib/aura-realtime';
import { supabase } from '@/lib/supabase';

type Visibility = 'public' | 'members' | 'private';
const VISIBILITY_OPTIONS: Visibility[] = ['public', 'members', 'private'];

/**
 * Profilo Evolutivo — own authenticated view (PRD §4.2, M1). Mobile parity with
 * apps/web/app/(app)/profile/profile-view.tsx: view + inline edit of bio /
 * identity / seeking / locale + per-field visibility, dream read-only (editor is
 * M2), Six Stars grid seeded from Aura snapshot (score engine M6). The public
 * @handle SSR page is a separate M2 deliverable.
 */
export default function ProfileScreen() {
  const { profile, session, refreshProfile } = useAuth();

  if (!profile || !session) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text
          className="text-2xl text-muted-foreground"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          ✦
        </Text>
      </View>
    );
  }

  return (
    <ProfileEditor userId={session.user.id} profile={profile} refreshProfile={refreshProfile} />
  );
}

function ProfileEditor({
  userId,
  profile,
  refreshProfile,
}: {
  userId: string;
  profile: Profile;
  refreshProfile: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [identity, setIdentity] = useState<string[]>(profile.identity_tags);
  const [seeking, setSeeking] = useState<string[]>(profile.seeking);
  const [locale, setLocale] = useState<Locale>(profile.locale);
  const [visibility, setVisibility] = useState<Record<string, Visibility>>(
    profile.visibility as Record<string, Visibility>,
  );
  const [dreamText, setDreamText] = useState<string | null>(null);
  const [dreamId, setDreamId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [mutatingMilestoneId, setMutatingMilestoneId] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Help[]>([]);
  const [helperNames, setHelperNames] = useState<Record<string, string>>({});
  const [mutatingHelpId, setMutatingHelpId] = useState<string | null>(null);
  const [flashMilestoneId, setFlashMilestoneId] = useState<string | null>(null);
  const [starToast, setStarToast] = useState<string | null>(null);
  const [starFlash, setStarFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Realtime wiring: star grants show a toast + flash; tier-up navigates to /level.
  // Cache invalidation (auraKeys / ledgerKeys / starKeys) happens inside the hook.
  useAuraRealtime(userId, {
    onStarEarned: (starId) => {
      // Localize the star id → display name for the toast.
      const name = t(`star.${starId}` as MessageKey, locale);
      setStarToast(t('star.earned.toast', locale, { star: name }));
      setStarFlash(true);
      setTimeout(() => {
        setStarToast(null);
        setStarFlash(false);
      }, 2800);
    },
  });

  // Live own momenti (rule #9: getMomentsPage is keyset). First page (24) is enough
  // for MVP — infinite scroll on the full grid is deferred.
  const momentsQuery = useQuery({
    queryKey: momentKeys.list(userId),
    queryFn: () => getMomentsPage(supabase, userId),
    enabled: Boolean(userId),
  });
  const moments = momentsQuery.data?.moments ?? [];
  const { urls } = useSignedUrls(
    'moments',
    moments.map((m) => m.media_path),
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { addMoment } = useMomentUpload(userId);

  // Read-only Aura snapshot — TanStack (M6 score-engine fills real values; coalesces to zero).
  const auraQuery = useQuery({
    queryKey: auraKeys.score(userId),
    queryFn: () => getAuraScore(supabase, userId),
    enabled: Boolean(userId),
  });
  const aura: AuraSnapshot = auraQuery.data ?? ZERO_AURA_SNAPSHOT;

  // Stars for the Six Stars grid — TanStack (engine dormant → [] → all unearned).
  const starsQuery = useQuery({
    queryKey: starKeys.list(userId),
    queryFn: () => getStars(supabase, userId),
    enabled: Boolean(userId),
  });
  const stars = starsQuery.data ?? [];

  // Refetch the active dream + its tappe whenever Profilo regains focus (e.g. after editing).
  // Also invalidates Aura + Stars so the grid refreshes after confirmed help events.
  useFocusEffect(
    useCallback(() => {
      // Invalidate Aura caches (preserves focus-refetch behaviour from old useEffect).
      void queryClient.invalidateQueries({ queryKey: auraKeys.score(userId) });
      void queryClient.invalidateQueries({ queryKey: starKeys.list(userId) });

      let cancelled = false;
      getActiveDream(supabase, userId)
        .then(async (d) => {
          if (cancelled) return;
          setDreamText(d?.text ?? null);
          setDreamId(d?.id ?? null);
          if (d?.id) {
            const tappe = await listMilestones(supabase, d.id);
            if (cancelled) return;
            setMilestones(tappe);
            // Owner-side «Aiuti in arrivo»: offers on my tappe + their helper display names.
            const offers = await listIncomingHelps(
              supabase,
              tappe.map((m) => m.id),
            );
            if (cancelled) return;
            setIncoming(offers);
            // resolve distinct helper names (best-effort; fall back to a short id)
            const ids = [...new Set(offers.map((o) => o.helper_id))];
            const names: Record<string, string> = {};
            for (const hid of ids) {
              try {
                const p = await getProfileById(supabase, hid);
                names[hid] = p?.handle ?? hid.slice(0, 8);
              } catch {
                names[hid] = hid.slice(0, 8);
              }
            }
            if (!cancelled) setHelperNames(names);
          } else {
            setMilestones([]);
            setIncoming([]);
          }
        })
        .catch(() => {
          // leave dream unset; the empty state is the safe default
        });
      return () => {
        cancelled = true;
      };
    }, [userId, queryClient]),
  );

  const completeness = profileCompleteness({
    handle: profile.handle,
    bio,
    identity_tags: identity,
    seeking,
    hasDream: dreamText != null,
  });

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]);

  const setVis = (field: string, value: Visibility) =>
    setVisibility((v) => ({ ...v, [field]: value }));

  const reset = () => {
    setBio(profile.bio ?? '');
    setIdentity(profile.identity_tags);
    setSeeking(profile.seeking);
    setLocale(profile.locale);
    setVisibility(profile.visibility as Record<string, Visibility>);
    setError(null);
  };

  const cancel = () => {
    reset();
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(supabase, userId, {
        bio: bio.trim() ? bio.trim() : null,
        identity_tags: identity,
        seeking,
        locale,
        visibility,
      });
      await refreshProfile();
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError(t('profile.error', locale));
    } finally {
      setSaving(false);
    }
  };

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  // Native share sheet: shares the @handle + app name (mirrors home InviteCard;
  // tracked-referral attribution is a later milestone).
  const shareProfile = async () => {
    const handle = profile.handle;
    const message = handle
      ? `@${handle} — ${t('app.name', locale)}`
      : t('app.name', locale);
    try {
      await Share.share({ message });
    } catch {
      // user dismissed or share unavailable — no-op
    }
  };

  const refetchMilestones = useCallback(async () => {
    if (!dreamId) return;
    try {
      setMilestones(await listMilestones(supabase, dreamId));
    } catch {
      // keep the optimistic state; a later focus refetch reconciles
    }
  }, [dreamId]);

  // Reconcile «Aiuti in arrivo» after a failed respond/confirm so the optimistic flip
  // can't diverge until the next focus. Best-effort: keeps optimistic state on error.
  const refetchIncoming = useCallback(async () => {
    try {
      setIncoming(
        await listIncomingHelps(
          supabase,
          milestones.map((m) => m.id),
        ),
      );
    } catch {
      // keep the optimistic state; a later focus refetch reconciles
    }
  }, [milestones]);

  const handleMarkMilestoneDone = async (id: string) => {
    setMutatingMilestoneId(id);
    // optimistic ✓ (frontend §3.1 tappa-mutating)
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'done' as const } : m)));
    try {
      await updateMilestoneStatus(supabase, id, 'done');
      await refetchMilestones();
    } catch {
      await refetchMilestones();
    } finally {
      setMutatingMilestoneId(null);
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    setMutatingMilestoneId(id);
    setMilestones((prev) => prev.filter((m) => m.id !== id)); // optimistic remove
    try {
      await softDeleteMilestone(supabase, id);
      await refetchMilestones();
    } catch {
      await refetchMilestones();
    } finally {
      setMutatingMilestoneId(null);
    }
  };

  // Owner accepts/declines an incoming offer (optimistic; a later focus refetch reconciles).
  const handleRespond = async (id: string, status: 'accepted' | 'declined') => {
    setMutatingHelpId(id);
    setIncoming((prev) =>
      status === 'declined'
        ? prev.filter((h) => h.id !== id)
        : prev.map((h) => (h.id === id ? { ...h, status } : h)),
    );
    try {
      await respondToHelp(supabase, id, status);
    } catch {
      await refetchIncoming(); // reconcile the optimistic flip on failure
    } finally {
      setMutatingHelpId(null);
    }
  };

  // Owner confirms the help is done — the +40/+10 domain event. Writes NO aura_* (rule #1):
  // the confirm_milestone_help RPC atomically flips milestone_helps + dream_milestones; M6 scores.
  const handleConfirmHelp = async (helpId: string, milestoneId: string) => {
    setMutatingHelpId(helpId);
    setFlashMilestoneId(milestoneId);
    // optimistic: mark the tappa done + the offer completed
    setMilestones((prev) =>
      prev.map((m) => (m.id === milestoneId ? { ...m, status: 'done' as const } : m)),
    );
    setIncoming((prev) =>
      prev.map((h) => (h.id === helpId ? { ...h, status: 'completed' as const } : h)),
    );
    try {
      await confirmHelpComplete(supabase, helpId);
      await refetchMilestones();
    } catch {
      await refetchMilestones();
      await refetchIncoming(); // reconcile the optimistic completed-flip on failure
    } finally {
      setMutatingHelpId(null);
      setTimeout(() => setFlashMilestoneId(null), 700);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-8 px-5 py-12"
      keyboardShouldPersistTaps="handled"
    >
      {!editing ? (
        <>
          {/* Header row: share stub + edit toggle — sized to the 24px icon scale
              (tab glyphs / modal chevrons), HIT_SLOP like HomeHeader. */}
          <View className="flex-row items-center justify-end gap-5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.share.toast', locale)}
              hitSlop={HIT_SLOP}
              onPress={() => void shareProfile()}
            >
              <Text className="text-2xl text-aura">✦</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.title', locale)}
              hitSlop={HIT_SLOP}
              onPress={() => router.push('/(modal)/settings')}
            >
              <Text className="text-2xl text-faint">⚙</Text>
            </Pressable>
            <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={HIT_SLOP}>
              <Text className="text-base font-semibold text-faint">{t('profile.edit', locale)}</Text>
            </Pressable>
          </View>

          {/* Hero: avatar mandorla + handle + bio + Aura score */}
          <ProfileHero
            handle={profile.handle ?? ''}
            bio={bio || null}
            auraScore={aura.score}
            locale={locale}
            verified={profile.identity_verified}
          />

          {/* Completeness hint */}
          {completeness < 1 ? (
            <Text className="text-center text-[13px] text-faint">
              {t('profile.completeness', locale, { percent: Math.round(completeness * 100) })}
            </Text>
          ) : null}

          {/* Stat line: collabs / events / reviews (M1 stubs) */}
          <StatLine
            items={[
              { value: '0', label: t('profile.stat.collabs', locale) },
              { value: '0', label: t('profile.stat.events', locale) },
              { value: '0', label: t('profile.stat.reviews', locale) },
            ]}
          />

          {/* Connessioni — hub for established connections + the Richieste inbox (M5). */}
          <View className="-mx-5 border-y border-hair">
            <SettingsRow
              title={t('connection.hub.title', locale)}
              accessibilityLabel={t('connection.a11y.hub', locale)}
              onPress={() => router.push('/connections')}
            />
          </View>

          {/* Le Sei Stelle */}
          <View className="gap-3">
            <SectionLabel>{t('profile.stars.title', locale)}</SectionLabel>
            <SixStarsGrid
              stars={stars}
              viewerIsOwner={true}
              locale={locale}
              onStarPress={(id: StarKey) =>
                router.push({ pathname: '/(modal)/star', params: { starId: id } })
              }
            />
            <StarProgress next={pickNextStar(stars)} locale={locale} />
          </View>

          {/* I tuoi Momenti — live identity gallery (signed thumbs + create/upload) */}
          <View className="gap-2">
            <MomentiGallery
              moments={moments}
              urls={urls}
              locale={locale}
              onOpen={setLightboxIndex}
              onSeeAll={() => router.push('/(modal)/grid')}
              onAdd={() => setSheetOpen(true)}
            />
          </View>

          {/* Il Sogno — editable quote (dream editor) + tappe CRUD (M2) */}
          <DreamCard
            dream={dreamText}
            locale={locale}
            onEdit={() => router.push('/(modal)/dream-editor')}
            milestones={milestones}
            mutatingMilestoneId={mutatingMilestoneId}
            onAddMilestone={() =>
              router.push({ pathname: '/(modal)/milestone', params: { dreamId: dreamId ?? '' } })
            }
            onMarkMilestoneDone={handleMarkMilestoneDone}
            onDeleteMilestone={handleDeleteMilestone}
            incomingSlot={
              incoming.length > 0 ? (
                <View className="mt-2 gap-3 border-t border-hair pt-4">
                  <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                    {t('help.owner.sectionLabel', locale)}
                  </Text>
                  {incoming
                    .filter((h) => h.status === 'offered' || h.status === 'accepted')
                    .map((h) => (
                      <IncomingOfferRow
                        key={h.id}
                        help={h}
                        helperName={helperNames[h.helper_id] ?? '—'}
                        locale={locale}
                        mutating={mutatingHelpId === h.id}
                        onAccept={() => handleRespond(h.id, 'accepted')}
                        onDecline={() => handleRespond(h.id, 'declined')}
                        onConfirm={() => handleConfirmHelp(h.id, h.milestone_id)}
                      />
                    ))}
                </View>
              ) : null
            }
          />

          {/* Chi sei — identity tags */}
          {identity.length > 0 ? (
            <View className="gap-3">
              <SectionLabel>{t('profile.identity.label', locale)}</SectionLabel>
              <View className="flex-row flex-wrap gap-3">
                {identity.map((tag) => (
                  <Tag key={tag} label={tagLabel('tag.identity', tag)} />
                ))}
              </View>
            </View>
          ) : null}

          {/* Cosa cerchi — seeking tags */}
          {seeking.length > 0 ? (
            <View className="gap-3">
              <SectionLabel>{t('profile.seeking.label', locale)}</SectionLabel>
              <View className="flex-row flex-wrap gap-3">
                {seeking.map((tag) => (
                  <Tag key={tag} label={tagLabel('tag.seeking', tag)} />
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <>
          {/* Bio */}
          <Section
            label={t('profile.bio.label', locale)}
            field="bio"
            editing={editing}
            visibility={visibility}
            setVis={setVis}
            locale={locale}
          >
            <TextInput
              className="min-h-28 rounded-hero border border-hair bg-raise px-5 py-4 text-foreground"
              multiline
              maxLength={500}
              placeholder={t('profile.bio.empty', locale)}
              value={bio}
              onChangeText={setBio}
            />
          </Section>

          {/* Chi sei */}
          <Section
            label={t('profile.identity.label', locale)}
            field="identity_tags"
            editing={editing}
            visibility={visibility}
            setVis={setVis}
            locale={locale}
          >
            <View className="flex-row flex-wrap gap-3">
              {IDENTITY_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tagLabel('tag.identity', tag)}
                  selected={identity.includes(tag)}
                  onPress={() => toggle(identity, setIdentity, tag)}
                />
              ))}
            </View>
          </Section>

          {/* Cosa cerchi */}
          <Section
            label={t('profile.seeking.label', locale)}
            field="seeking"
            editing={editing}
            visibility={visibility}
            setVis={setVis}
            locale={locale}
          >
            <View className="flex-row flex-wrap gap-3">
              {SEEKING_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tagLabel('tag.seeking', tag)}
                  selected={seeking.includes(tag)}
                  onPress={() => toggle(seeking, setSeeking, tag)}
                />
              ))}
            </View>
          </Section>

          {/* Lingua + actions */}
          <View className="gap-3">
            <SectionLabel>{t('onboarding.locale.label', locale)}</SectionLabel>
            <View className="flex-row gap-3">
              <Chip
                label={t('lang.it', locale)}
                selected={locale === 'it'}
                onPress={() => setLocale('it')}
              />
              <Chip
                label={t('lang.en', locale)}
                selected={locale === 'en'}
                onPress={() => setLocale('en')}
              />
            </View>

            {error ? <Text className="text-sm text-error">{error}</Text> : null}

            <View className="flex-row items-center gap-4">
              <Button
                label={t('profile.save', locale)}
                variant="primary"
                disabled={saving}
                onPress={save}
              />
              <Button
                label={t('profile.cancel', locale)}
                variant="ghost"
                disabled={saving}
                onPress={cancel}
              />
            </View>
          </View>
        </>
      )}

      {saved ? <Text className="text-sm text-success">{t('profile.saved', locale)}</Text> : null}

      <Lightbox
        moments={moments}
        urls={urls}
        index={lightboxIndex}
        locale={locale}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
      />

      {/* «Aggiungi un Momento» — real create/upload (rule #1: writes only `moments`). */}
      <MediaSheet
        visible={sheetOpen}
        allowVideo
        locale={locale}
        onClose={() => setSheetOpen(false)}
        onPick={(m) => addMoment(m).catch(() => setError(t('media.failed', locale)))}
      />

      {/* The one glow moment (rule #4): a help became real. Reduced-motion safe (§9). */}
      <MomentFlash visible={flashMilestoneId != null} locale={locale} />

      {/* Star-earned flash (rule #4): a new star was lit — uses MomentFlash. */}
      <MomentFlash visible={starFlash} locale={locale} />

      {/* Star-earned toast: transient inline surface (shared Toast recipe). */}
      {starToast ? <Toast label={starToast} /> : null}
    </ScrollView>
  );
}

/** A labelled profile block with a visibility control shown only in edit mode. */
function Section({
  label,
  field,
  editing,
  visibility,
  setVis,
  locale,
  children,
}: {
  label: string;
  field: string;
  editing: boolean;
  visibility: Record<string, Visibility>;
  setVis: (field: string, value: Visibility) => void;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <Card>
      <View className="flex-row items-center justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        {editing ? (
          <View
            className="flex-row gap-1.5"
            accessibilityRole="radiogroup"
            accessibilityLabel={t('profile.visibility.label', locale)}
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <Chip
                key={opt}
                small
                label={t(`visibility.${opt}` as MessageKey, locale)}
                selected={(visibility[field] ?? 'public') === opt}
                onPress={() => setVis(field, opt)}
              />
            ))}
          </View>
        ) : null}
      </View>
      {children}
    </Card>
  );
}
