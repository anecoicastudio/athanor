import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { getActiveDream, updateProfile } from '@kaira/api';
import { IDENTITY_TAGS, profileCompleteness, SEEKING_TAGS } from '@kaira/core';
import { t, type MessageKey } from '@kaira/i18n';
import type { Locale, Profile } from '@kaira/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { Tag } from '@/components/Tag';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

/** The Six Stars (PRD §4.10). Unearned ✦ glyphs in M1 — the engine is M6. */
const STARS = [
  'visionario',
  'creatore',
  'mentor',
  'innovatore',
  'collaboratore',
  'ambasciatore',
] as const;

type Visibility = 'public' | 'members' | 'private';
const VISIBILITY_OPTIONS: Visibility[] = ['public', 'members', 'private'];

/**
 * Profilo Evolutivo — own authenticated view (PRD §4.2, M1). Mobile parity with
 * apps/web/app/(app)/profilo/profile-view.tsx: view + inline edit of bio /
 * identity / seeking / locale + per-field visibility, dream read-only (editor is
 * M2), Six Stars outlines. The public @handle SSR page is a separate M2 deliverable.
 */
export default function ProfiloScreen() {
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Web fetches the active dream server-side; mobile fetches it client-side.
  useEffect(() => {
    let cancelled = false;
    getActiveDream(supabase, userId)
      .then((d) => {
        if (!cancelled) setDreamText(d?.text ?? null);
      })
      .catch(() => {
        // leave dream unset; the empty state is the safe default
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

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-8 px-5 py-12"
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View className="flex-row items-center gap-4">
        <Avatar handle={profile.handle} />
        <View className="flex-1">
          <Text className="text-2xl font-semibold text-foreground">@{profile.handle}</Text>
          {completeness < 1 ? (
            <Text className="text-[13px] text-muted-foreground">
              {t('profile.completeness', locale, { percent: Math.round(completeness * 100) })}
            </Text>
          ) : null}
        </View>
        {!editing ? (
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={8}>
            <Text className="font-semibold text-muted-foreground">{t('profile.edit', locale)}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Bio */}
      <Section
        label={t('profile.bio.label', locale)}
        field="bio"
        editing={editing}
        visibility={visibility}
        setVis={setVis}
        locale={locale}
      >
        {editing ? (
          <TextInput
            className="min-h-28 rounded-3xl border border-line bg-surface px-5 py-4 text-foreground"
            multiline
            maxLength={500}
            placeholder={t('profile.bio.empty', locale)}
            value={bio}
            onChangeText={setBio}
          />
        ) : bio ? (
          <Text className="text-foreground">{bio}</Text>
        ) : (
          <Text className="text-muted-foreground">{t('profile.bio.empty', locale)}</Text>
        )}
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
          {editing
            ? IDENTITY_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tagLabel('tag.identity', tag)}
                  selected={identity.includes(tag)}
                  onPress={() => toggle(identity, setIdentity, tag)}
                />
              ))
            : identity.map((tag) => <Tag key={tag} label={tagLabel('tag.identity', tag)} />)}
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
          {editing
            ? SEEKING_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tagLabel('tag.seeking', tag)}
                  selected={seeking.includes(tag)}
                  onPress={() => toggle(seeking, setSeeking, tag)}
                />
              ))
            : seeking.map((tag) => <Tag key={tag} label={tagLabel('tag.seeking', tag)} />)}
        </View>
      </Section>

      {/* Il Sogno — dream register (Instrument Serif italic). Read-only in M1; editor is M2. */}
      <Section
        label={t('profile.dream.label', locale)}
        field="dream"
        editing={editing}
        visibility={visibility}
        setVis={setVis}
        locale={locale}
      >
        {dreamText ? (
          <Text className="font-dream text-xl text-foreground">“{dreamText}”</Text>
        ) : (
          <EmptyState>{t('profile.dream.empty', locale)}</EmptyState>
        )}
      </Section>

      {/* Le Sei Stelle — unearned ✦ outlines (no score number; engine is M6) */}
      <View className="gap-3">
        <SectionLabel>{t('profile.stars.label', locale)}</SectionLabel>
        <View className="flex-row flex-wrap gap-5">
          {STARS.map((s) => (
            <View key={s} className="items-center gap-1.5">
              <Text className="text-2xl text-muted-foreground">✦</Text>
              <Text className="text-[11px] tracking-wide text-muted-foreground">
                {t(`star.${s}` as MessageKey, locale)}
              </Text>
            </View>
          ))}
        </View>
        <Text className="text-[13px] text-muted-foreground">{t('profile.stars.hint', locale)}</Text>
      </View>

      {/* Edit actions */}
      {editing ? (
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
      ) : null}

      {saved ? <Text className="text-sm text-success">{t('profile.saved', locale)}</Text> : null}
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
