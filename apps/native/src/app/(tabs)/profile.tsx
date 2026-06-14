import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getActiveDream,
  getAuraScore,
  listMilestones,
  softDeleteMilestone,
  updateMilestoneStatus,
  updateProfile,
} from '@athanor/api';
import { IDENTITY_TAGS, profileCompleteness, SEEKING_TAGS } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import {
  type AuraSnapshot,
  type Milestone,
  ZERO_AURA_SNAPSHOT,
  type Locale,
  type Profile,
} from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { DreamCard } from '@/components/DreamCard';
import { ProfileHero } from '@/components/ProfileHero';
import { SectionLabel } from '@/components/SectionLabel';
import { SixStarsGrid } from '@/components/SixStarsGrid';
import { Lightbox } from '@/components/Lightbox';
import { MomentiGallery } from '@/components/MomentiGallery';
import { StatLine } from '@/components/StatLine';
import { Tag } from '@/components/Tag';
import { MY_MOMENTS } from '@/types/moment';
import { useAuth } from '@/lib/auth-context';
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
        <Text className="text-2xl text-muted-foreground">✦</Text>
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
  const [aura, setAura] = useState<AuraSnapshot>(ZERO_AURA_SNAPSHOT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const moments = MY_MOMENTS; // M1 frame-only; M3 → useQuery(momentKeys.list(userId))
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [momentSoon, setMomentSoon] = useState(false);

  const addMomentSoon = () => {
    // Create/upload deferred to M3 — honest hint, never a fake success or Aura write (rule #1).
    setMomentSoon(true);
    setTimeout(() => setMomentSoon(false), 2000);
  };

  // Refetch the active dream + its tappe whenever Profilo regains focus (e.g. after editing).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getActiveDream(supabase, userId)
        .then(async (d) => {
          if (cancelled) return;
          setDreamText(d?.text ?? null);
          setDreamId(d?.id ?? null);
          if (d?.id) {
            const tappe = await listMilestones(supabase, d.id);
            if (!cancelled) setMilestones(tappe);
          } else {
            setMilestones([]);
          }
        })
        .catch(() => {
          // leave dream unset; the empty state is the safe default
        });
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  // Read-only Aura snapshot (M1 always zero; M6 score-engine fills real values).
  useEffect(() => {
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

  const refetchMilestones = useCallback(async () => {
    if (!dreamId) return;
    try {
      setMilestones(await listMilestones(supabase, dreamId));
    } catch {
      // keep the optimistic state; a later focus refetch reconciles
    }
  }, [dreamId]);

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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-8 px-5 py-12"
      keyboardShouldPersistTaps="handled"
    >
      {!editing ? (
        <>
          {/* Header row: share stub + edit toggle */}
          <View className="flex-row items-center justify-end gap-4">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.share.toast', locale)}
              hitSlop={8}
              onPress={() => {
                /* TODO(M2): open native share sheet */
              }}
            >
              <Text className="text-xl text-aura">✦</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.title', locale)}
              hitSlop={8}
              onPress={() => router.push('/(modal)/settings')}
            >
              <Text className="text-xl text-faint">⚙</Text>
            </Pressable>
            <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={8}>
              <Text className="font-semibold text-faint">{t('profile.edit', locale)}</Text>
            </Pressable>
          </View>

          {/* Hero: avatar mandorla + handle + bio + Aura score */}
          <ProfileHero
            handle={profile.handle ?? ''}
            bio={bio || null}
            auraScore={aura.score}
            locale={locale}
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

          {/* Le Sei Stelle */}
          <View className="gap-3">
            <SectionLabel>{t('profile.stars.title', locale)}</SectionLabel>
            <SixStarsGrid stars={aura.stars} locale={locale} />
          </View>

          {/* I tuoi Momenti — identity gallery (frame-only M1; live at M3) */}
          <View className="gap-2">
            <MomentiGallery
              moments={moments}
              locale={locale}
              onOpen={setLightboxIndex}
              onSeeAll={() => router.push('/(modal)/grid')}
              onAdd={addMomentSoon}
            />
            {momentSoon ? (
              <Text className="text-[13px] text-faint">{t('moment.soon', locale)}</Text>
            ) : null}
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
        index={lightboxIndex}
        locale={locale}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
      />
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
