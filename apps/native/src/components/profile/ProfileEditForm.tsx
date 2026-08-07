import { useState } from 'react';
import { updateProfile } from '@athanor/api';
import { IDENTITY_TAGS, SEEKING_TAGS } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, Profile } from '@athanor/schemas';
import { Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { DreamQuote } from '@/components/DreamQuote';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { Section, type Visibility } from '@/components/profile/Section';
import { supabase } from '@/lib/supabase';

/**
 * Edit-mode Profilo form: bio / identity / seeking / dream / locale + per-field
 * visibility. Owns the draft state internally; unmounting discards the draft
 * (cancel), a successful save persists then fires onSaved.
 *
 * The dream section is read-only here — the text is written in the dream editor
 * modal; this form owns only who may see it (visibility key 'dream').
 */
export function ProfileEditForm({
  userId,
  profile,
  dreamText,
  refreshProfile,
  onSaved,
  onCancel,
}: {
  userId: string;
  profile: Profile;
  dreamText: string | null;
  refreshProfile: () => Promise<void>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [bio, setBio] = useState(profile.bio ?? '');
  const [identity, setIdentity] = useState<string[]>(profile.identity_tags);
  const [seeking, setSeeking] = useState<string[]>(profile.seeking);
  const [locale, setLocale] = useState<Locale>(profile.locale);
  const [visibility, setVisibility] = useState<Record<string, Visibility>>(
    profile.visibility as Record<string, Visibility>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]);

  const setVis = (field: string, value: Visibility) =>
    setVisibility((v) => ({ ...v, [field]: value }));

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
      onSaved();
    } catch {
      setError(t('profile.error', locale));
    } finally {
      setSaving(false);
    }
  };

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  return (
    <>
      {/* Bio */}
      <Section
        label={t('profile.bio.label', locale)}
        field="bio"
        editing
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
        editing
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
        editing
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
        {/* The condition is the PAIR, not either field — don't "simplify" it.
            Affinity sums shared + seek_hit + offer_hit; offer_hit intersects the
            recipient's identity_tags with the candidate's `seeking`, and the two
            fields are masked by independent predicates. Hiding identity_tags
            alone leaves offer_hit live and the member keeps matching. Only both
            private reaches affinity 0. Pinned by persona E in
            supabase/tests/0073_visibility_followups.test.sql. Lives under the
            second of the two so both chip rows are already on screen.

            The copy says "matched", not "you won't appear": already-issued
            pending proposals survive the flip, and «Ti potrebbe interessare»
            (getMomentiSuggestion) has no tag-visibility predicate at all. What
            actually stops is new matching. Labels are interpolated from the
            same keys the chips render, so a renamed label can't leave the
            sentence quoting something that no longer exists. */}
        {(visibility.identity_tags ?? 'members') === 'private' &&
        (visibility.seeking ?? 'members') === 'private' ? (
          <Text className="text-[13px] leading-snug text-muted-foreground">
            {t('profile.visibility.tagsPrivateHint', locale, {
              identity: t('profile.identity.label', locale),
              seeking: t('profile.seeking.label', locale),
              private: t('visibility.private', locale),
            })}
          </Text>
        ) : null}
      </Section>

      {/* Il mio sogno — visibility only; the text lives in the dream editor.
          The 'dream' key gates dreams + dream_milestones reads (M10 RLS) and
          keeps a private dreamer out of the Momenti deck (matcher gate). */}
      <Section
        label={t('dream.ownLabel', locale)}
        field="dream"
        editing
        visibility={visibility}
        setVis={setVis}
        locale={locale}
      >
        {dreamText ? (
          <DreamQuote text={dreamText} />
        ) : (
          <EmptyState>{t('dream.empty.title', locale)}</EmptyState>
        )}
        {/* «Solo io» costs more than privacy: the matcher drops a private-dream
            member as a candidate, so they stop being proposed to anyone. Shown
            only on that choice — a standing line would be noise on the others. */}
        {(visibility.dream ?? 'members') === 'private' ? (
          <Text className="text-[13px] leading-snug text-muted-foreground">
            {t('dream.visibility.privateHint', locale)}
          </Text>
        ) : null}
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
            onPress={onCancel}
          />
        </View>
      </View>
    </>
  );
}
