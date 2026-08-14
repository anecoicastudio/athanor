import type { ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  auraKeys,
  getAuraScore,
  getMomentsPage,
  getProfileStatCounts,
  getStars,
  momentKeys,
  profileKeys,
  starKeys,
} from '@athanor/api';
import { profileCompleteness } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { AuraSnapshot, Locale, Profile, StarKey } from '@athanor/schemas';
import { Text, View } from '@/tw';
import { SectionLabel } from '@/components/SectionLabel';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { Lightbox } from '@/components/media/Lightbox';
import { MediaSheet } from '@/components/media/MediaSheet';
import { ProfileBody } from '@/components/profile/ProfileBody';
import { Tag } from '@/components/Tag';
import { auraSnapshotOrNull, starsOrNull } from '@/lib/aura-display';
import { listState } from '@/lib/list-state';
import { useMomentUpload } from '@/lib/media/use-moment-upload';
import { momentSignPaths } from '@/lib/media/moment-media';
import { uploadErrorKey } from '@/lib/media/upload';
import { useSignedUrls } from '@/lib/media/use-signed-urls';
import { supabase } from '@/lib/supabase';

/**
 * Read-mode Profilo stack: hero → stat line → Sei Stelle → Momenti (frontend 02
 * §3.5), plus the dream slot and Chi sei / Cosa cerchi tags. Owns the momenti
 * cluster (query, signed urls, lightbox, MediaSheet upload).
 */
export function ProfileView({
  userId,
  profile,
  locale,
  hasDream,
  dreamSlot,
}: {
  userId: string;
  profile: Profile;
  locale: Locale;
  hasDream: boolean;
  dreamSlot: ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Live own momenti (rule #9: getMomentsPage is keyset). First page (24) is enough
  // for MVP — infinite scroll on the full grid is deferred.
  const momentsQuery = useQuery({
    queryKey: momentKeys.list(userId),
    queryFn: () => getMomentsPage(supabase, userId),
    enabled: Boolean(userId),
  });
  const moments = momentsQuery.data?.moments ?? [];
  // Posters as well as media: the gallery tiles draw a video's poster, the Lightbox plays the
  // video itself, and both read this one map (#131).
  const { urls, isLoading: urlsLoading } = useSignedUrls('moments', momentSignPaths(moments));
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { addMoment } = useMomentUpload(userId);

  // Read-only Aura snapshot — TanStack. `null` until it lands, never a stand-in zero.
  const auraQuery = useQuery({
    queryKey: auraKeys.score(userId),
    queryFn: () => getAuraScore(supabase, userId),
    enabled: Boolean(userId),
  });
  const aura: AuraSnapshot | null = auraSnapshotOrNull(auraQuery.data, auraQuery.isError);

  // Stars for the Six Stars grid — TanStack (engine dormant → [] → all unearned). `null` when
  // the read failed: this query is INDEPENDENT of the Aura one above, so `?? []` let the hero
  // show a real score while the grid below claimed six unearned stars (issue #16).
  const starsQuery = useQuery({
    queryKey: starKeys.list(userId),
    queryFn: () => getStars(supabase, userId),
    enabled: Boolean(userId),
  });
  const stars = starsOrNull(starsQuery.data, starsQuery.isError);

  // Stat-line counts (collabs completed / events attended) — aggregate-only DEFINER RPC (P3.1).
  const statCountsQuery = useQuery({
    queryKey: profileKeys.statCounts(userId),
    queryFn: () => getProfileStatCounts(supabase, userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const statCounts = statCountsQuery.data;

  const completeness = profileCompleteness({
    handle: profile.handle,
    bio: profile.bio ?? '',
    identity_tags: profile.identity_tags,
    seeking: profile.seeking,
    hasDream,
  });

  const identity = profile.identity_tags;
  const seeking = profile.seeking;

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  return (
    <>
      {/* Shared Profilo stack: hero → stat line → Sei Stelle → Momenti (frontend 02 §3.5) */}
      <ProfileBody
        locale={locale}
        hero={{
          handle: profile.handle ?? '',
          displayName: profile.display_name,
          avatarPath: profile.avatar_path,
          bio: profile.bio || null,
          auraScore: aura?.score ?? null,
          locale,
          verified: profile.identity_verified,
          founding: profile.founding_member,
        }}
        statCounts={statCounts}
        afterHero={
          completeness < 1 ? (
            <Text className="text-center text-[13px] text-faint">
              {t('profile.completeness', locale, { percent: Math.round(completeness * 100) })}
            </Text>
          ) : null
        }
        afterStats={
          /* Connessioni — hub for established connections + the Richieste inbox (M5). */
          <View className="-mx-5 border-y border-hair">
            <SettingsRow
              title={t('connection.hub.title', locale)}
              accessibilityLabel={t('connection.a11y.hub', locale)}
              onPress={() => router.push('/connections')}
            />
          </View>
        }
        stars={stars}
        viewerIsOwner={true}
        onStarPress={(id: StarKey) =>
          router.push({ pathname: '/(modal)/star', params: { starId: id } })
        }
        gallery={{
          moments,
          urls,
          urlsLoading,
          locale,
          state: listState({
            status: momentsQuery.status,
            fetchStatus: momentsQuery.fetchStatus,
            isEmpty: moments.length === 0,
            staleWins: true,
          }),
          onRetry: () => void momentsQuery.refetch(),
          onOpen: setLightboxIndex,
          onSeeAll: () => router.push('/(modal)/grid'),
          onAdd: () => setSheetOpen(true),
        }}
      />

      {/* Il Sogno — editable quote (dream editor) + tappe CRUD (M2) */}
      {dreamSlot}

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

      {error ? <Text className="text-sm text-error">{error}</Text> : null}

      <Lightbox
        moments={moments}
        urls={urls}
        urlsLoading={urlsLoading}
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
        onPick={(m) => addMoment(m).catch((err) => setError(t(uploadErrorKey(err), locale)))}
        onError={() => setError(t('media.failed', locale))}
      />
    </>
  );
}
