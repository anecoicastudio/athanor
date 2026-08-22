import { useState } from 'react';
import { updateProfile } from '@athanor/api';
import { IDENTITY_TAGS, MAX_SKILLS, PROFESSIONS, SEEKING_TAGS, SKILLS } from '@athanor/core';
import { t, type MessageKey } from '@athanor/i18n';
import type { Locale, Profile } from '@athanor/schemas';
import { Pressable, Text, TextInput, View } from '@/tw';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { DreamQuote } from '@/components/DreamQuote';
import { LocaleChips } from '@/components/LocaleChips';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { MediaSheet } from '@/components/media/MediaSheet';
import { CityPicker } from '@/components/profile/CityPicker';
import { Section, type Visibility } from '@/components/profile/Section';
import { useAvatarUpload } from '@/lib/media/use-avatar-upload';
import { toggleTag } from '@/lib/tags';
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
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [avatarPath, setAvatarPath] = useState<string | null>(profile.avatar_path);
  const [sheetOpen, setSheetOpen] = useState(false);
  const avatar = useAvatarUpload(userId);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [mission, setMission] = useState(profile.mission ?? '');
  const [identity, setIdentity] = useState<string[]>(profile.identity_tags);
  const [seeking, setSeeking] = useState<string[]>(profile.seeking);
  const [profession, setProfession] = useState<string | null>(profile.profession);
  const [skills, setSkills] = useState<string[]>(profile.skills ?? []);
  const [city, setCity] = useState(profile.city ?? '');
  // NULL whenever the city is free text; only a picked suggestion sets it.
  const [cityGeohash, setCityGeohash] = useState<string | null>(profile.city_geohash);
  const [locale, setLocale] = useState<Locale>(profile.locale);
  const [visibility, setVisibility] = useState<Record<string, Visibility>>(
    profile.visibility as Record<string, Visibility>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setVis = (field: string, value: Visibility) =>
    setVisibility((v) => ({ ...v, [field]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(supabase, userId, {
        // Empty means «I have no name», which is a legal state — not «leave it as it was».
        display_name: displayName.trim() ? displayName.trim() : null,
        avatar_path: avatarPath,
        bio: bio.trim() ? bio.trim() : null,
        mission: mission.trim() ? mission.trim() : null,
        identity_tags: identity,
        seeking,
        profession,
        skills,
        city: city.trim() ? city.trim() : null,
        // A geohash only ever accompanies a picked, non-empty city.
        city_geohash: city.trim() ? cityGeohash : null,
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

  const tagLabel = (
    prefix: 'tag.identity' | 'tag.seeking' | 'tag.profession' | 'tag.skill',
    key: string,
  ) => t(`${prefix}.${key}` as MessageKey, locale);

  const toggleSkill = (key: string) =>
    setSkills((prev) =>
      prev.includes(key)
        ? prev.filter((x) => x !== key)
        : prev.length >= MAX_SKILLS
          ? prev
          : [...prev, key],
    );

  return (
    <>
      {/* Identità — name + photo (#76). Still not inside a <Section>: the block-level control
          below writes the ONE identity facet (#251) for both fields together, not a per-field
          eye. 'public' (the default) keeps the /@handle link resolving for anyone; 'members'
          kills the public shell — a knowingly dead link. 'private' is deliberately not offered:
          members always see name and photo (the facet gates anon only, profile.ts docblock),
          so a «Solo io» chip here would promise a setting that does not exist. */}
      <View className="gap-3">
        <SectionLabel>{t('profile.photo.label', locale)}</SectionLabel>
        <View className="flex-row items-center gap-4">
          <Avatar
            handle={profile.handle}
            displayName={displayName}
            avatarPath={avatarPath}
            size={72}
          />
          <View className="flex-1 gap-1.5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.photo.a11y', locale)}
              disabled={avatar.status === 'uploading'}
              onPress={() => setSheetOpen(true)}
            >
              <Text className="text-[14px] font-semibold text-aura">
                {avatarPath ? t('profile.photo.change', locale) : t('profile.photo.add', locale)}
              </Text>
            </Pressable>
            {avatarPath ? (
              <Pressable accessibilityRole="button" onPress={() => setAvatarPath(null)}>
                <Text className="text-[13px] text-muted-foreground">
                  {t('profile.photo.remove', locale)}
                </Text>
              </Pressable>
            ) : null}
            {avatar.status === 'uploading' ? (
              <Text className="text-[13px] text-faint">{t('profile.photo.uploading', locale)}</Text>
            ) : null}
            {avatar.status === 'error' ? (
              <Text className="text-[13px] text-error">{t('profile.photo.error', locale)}</Text>
            ) : null}
          </View>
        </View>

        <SectionLabel>{t('profile.name.label', locale)}</SectionLabel>
        <TextInput
          className="rounded-hero border border-hair bg-raise px-5 py-4 text-foreground"
          maxLength={60}
          placeholder={t('profile.name.empty', locale)}
          value={displayName}
          onChangeText={setDisplayName}
        />
        <Text className="text-[13px] text-muted-foreground">{t('profile.name.hint', locale)}</Text>

        {/* The identity facet (#251): one control for the whole block, same visual grammar as
            Section's chip row. An absent key means the DEFAULT — public — never 'members'
            (the row policy coalesces the same way), and a stray 'private' value normalises to
            the members chip: anon-dark either way. */}
        <View className="flex-row items-center justify-between gap-3">
          <SectionLabel>{t('profile.visibility.label', locale)}</SectionLabel>
          <View
            className="flex-row gap-1.5"
            accessibilityRole="radiogroup"
            accessibilityLabel={t('profile.visibility.label', locale)}
          >
            {(['public', 'members'] as const).map((opt) => (
              <Chip
                key={opt}
                small
                label={t(`visibility.${opt}`, locale)}
                selected={
                  ((visibility.identity ?? 'public') === 'public' ? 'public' : 'members') === opt
                }
                onPress={() => setVis('identity', opt)}
              />
            ))}
          </View>
        </View>
        <Text className="text-[13px] leading-snug text-muted-foreground">
          {t('profile.shell.hint', locale)}
        </Text>
      </View>

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

      {/* La mia missione — free text like bio, the member's own words (#149) */}
      <Section
        label={t('profile.mission.label', locale)}
        field="mission"
        editing
        visibility={visibility}
        setVis={setVis}
        locale={locale}
      >
        <TextInput
          className="min-h-28 rounded-hero border border-hair bg-raise px-5 py-4 text-foreground"
          multiline
          maxLength={500}
          placeholder={t('profile.mission.empty', locale)}
          value={mission}
          onChangeText={setMission}
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
              onPress={() => setIdentity(toggleTag(identity, tag))}
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
              onPress={() => setSeeking(toggleTag(seeking, tag))}
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

            The copy says "matched", not "you won't appear". Both original
            reasons have since been closed — the deck recomputes and re-masks its
            affinity terms on every read (get_momenti_deck, #273 D; the purge
            trigger that used to DELETE the pending proposals on the flip is
            retired) and «Ti potrebbe interessare» gained the predicate
            (get_momenti_suggestion) — but "matched" is still the
            accurate claim: accepted and passed rows deliberately survive, so the
            member does not vanish from every surface. Keep the weaker promise.
            Labels are interpolated from the same keys the chips render, so a
            renamed label can't leave the sentence quoting something that no
            longer exists. */}
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

      {/* Professione — single curated key: tapping the selected chip clears it (#149) */}
      <Section
        label={t('profile.profession.label', locale)}
        field="profession"
        editing
        visibility={visibility}
        setVis={setVis}
        locale={locale}
      >
        <View className="flex-row flex-wrap gap-3">
          {PROFESSIONS.map((key) => (
            <Chip
              key={key}
              label={tagLabel('tag.profession', key)}
              selected={profession === key}
              onPress={() => setProfession(profession === key ? null : key)}
            />
          ))}
        </View>
      </Section>

      {/* Competenze — curated multi-select, capped at MAX_SKILLS (#149) */}
      <Section
        label={t('profile.skills.label', locale)}
        field="skills"
        editing
        visibility={visibility}
        setVis={setVis}
        locale={locale}
      >
        <View className="flex-row flex-wrap gap-3">
          {SKILLS.map((key) => (
            <Chip
              key={key}
              label={tagLabel('tag.skill', key)}
              selected={skills.includes(key)}
              onPress={() => toggleSkill(key)}
            />
          ))}
        </View>
        <Text className="text-[13px] text-muted-foreground">
          {t('profile.skills.hint', locale)}
        </Text>
      </Section>

      {/* Città — typed-text search, approximate by design (#149) */}
      <Section
        label={t('profile.city.label', locale)}
        field="city"
        editing
        visibility={visibility}
        setVis={setVis}
        locale={locale}
      >
        <CityPicker
          city={city}
          locale={locale}
          onChange={(nextCity, geohash) => {
            setCity(nextCity);
            setCityGeohash(geohash);
          }}
        />
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
        <LocaleChips value={locale} onChange={setLocale} />

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

      {/* Kept mounted, never conditionally rendered: on iOS the picker is launched from the
          Modal's onDismiss, and an unmount kills the queued launch (MediaSheet's docblock). */}
      <MediaSheet
        visible={sheetOpen}
        locale={locale}
        onClose={() => setSheetOpen(false)}
        onPick={(asset) => {
          void avatar.upload(asset).then((key) => {
            if (key) setAvatarPath(key);
          });
        }}
      />
    </>
  );
}
