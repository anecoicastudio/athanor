'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { updateProfile } from '@auria/api';
import { IDENTITY_TAGS, profileCompleteness, SEEKING_TAGS } from '@auria/core';
import type { MessageKey } from '@auria/i18n';
import type { Locale, Profile } from '@auria/schemas';
import { Chip, Tag } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { KairosStar } from '@/components/icons';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Toast } from '@/components/ui/toast';
import { useI18n } from '@/lib/i18n';
import { createClient } from '@/utils/supabase/client';

/** The Six Stars (PRD §4.10). Rendered as unearned outlines in M1 — the engine is M6. */
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

export function ProfileView({
  userId,
  profile,
  dreamText,
}: {
  userId: string;
  profile: Profile;
  dreamText: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [identity, setIdentity] = useState<string[]>(profile.identity_tags);
  const [seeking, setSeeking] = useState<string[]>(profile.seeking);
  const [locale, setLocale] = useState<Locale>(profile.locale);
  const [visibility, setVisibility] = useState<Record<string, Visibility>>(
    profile.visibility as Record<string, Visibility>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

  const completeness = profileCompleteness({
    handle: profile.handle,
    bio,
    identity_tags: identity,
    seeking,
    hasDream: dreamText != null,
  });

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]);

  const vis = (field: string): Visibility => visibility[field] ?? 'public';
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
      const supabase = createClient();
      await updateProfile(supabase, userId, {
        bio: bio.trim() ? bio.trim() : null,
        identity_tags: identity,
        seeking,
        locale,
        visibility,
      });
      setEditing(false);
      setToast(true);
      window.setTimeout(() => setToast(false), 2500);
      router.refresh();
    } catch {
      setError(t('profile.error'));
    } finally {
      setSaving(false);
    }
  };

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey);

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Avatar handle={profile.handle} size={72} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-foreground">@{profile.handle}</h1>
          {completeness < 1 ? (
            <p className="text-[13px] text-muted-foreground">
              {t('profile.completeness', { percent: Math.round(completeness * 100) })}
            </p>
          ) : null}
        </div>
        {!editing ? (
          <Button variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
            {t('profile.edit')}
          </Button>
        ) : null}
      </div>

      {/* Bio */}
      <Section
        label={t('profile.bio.label')}
        visibilityField="bio"
        {...{ editing, vis, setVis, t }}
      >
        {editing ? (
          <Textarea
            rows={4}
            maxLength={500}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t('profile.bio.empty')}
          />
        ) : bio ? (
          <p className="text-foreground">{bio}</p>
        ) : (
          <p className="text-muted-foreground">{t('profile.bio.empty')}</p>
        )}
      </Section>

      {/* Chi sei */}
      <Section
        label={t('profile.identity.label')}
        visibilityField="identity_tags"
        {...{ editing, vis, setVis, t }}
      >
        <div className="flex flex-wrap gap-3">
          {editing
            ? IDENTITY_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  selected={identity.includes(tag)}
                  onClick={() => toggle(identity, setIdentity, tag)}
                >
                  {tagLabel('tag.identity', tag)}
                </Chip>
              ))
            : identity.map((tag) => <Tag key={tag}>{tagLabel('tag.identity', tag)}</Tag>)}
        </div>
      </Section>

      {/* Cosa cerchi */}
      <Section
        label={t('profile.seeking.label')}
        visibilityField="seeking"
        {...{ editing, vis, setVis, t }}
      >
        <div className="flex flex-wrap gap-3">
          {editing
            ? SEEKING_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  selected={seeking.includes(tag)}
                  onClick={() => toggle(seeking, setSeeking, tag)}
                >
                  {tagLabel('tag.seeking', tag)}
                </Chip>
              ))
            : seeking.map((tag) => <Tag key={tag}>{tagLabel('tag.seeking', tag)}</Tag>)}
        </div>
      </Section>

      {/* Il Sogno — dream register (Instrument Serif italic). Read-only in M1; editor is M2. */}
      <Section
        label={t('profile.dream.label')}
        visibilityField="dream"
        {...{ editing, vis, setVis, t }}
      >
        {dreamText ? (
          <p className="font-dream text-xl text-foreground">“{dreamText}”</p>
        ) : (
          <EmptyState>{t('profile.dream.empty')}</EmptyState>
        )}
      </Section>

      {/* Le Sei Stelle — unearned outlines (no score number; engine is M6) */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {t('profile.stars.label')}
        </h2>
        <div className="flex flex-wrap gap-5">
          {STARS.map((s) => (
            <div key={s} className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <KairosStar size={24} />
              <span className="text-[11px] tracking-wide">{t(`star.${s}` as MessageKey)}</span>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">{t('profile.stars.hint')}</p>
      </div>

      {/* Edit actions */}
      {editing ? (
        <div className="flex flex-col gap-3">
          {/* Language */}
          <div className="flex flex-col gap-2">
            <SectionLabel>{t('onboarding.locale.label')}</SectionLabel>
            <div className="flex gap-3">
              <Chip selected={locale === 'it'} onClick={() => setLocale('it')}>
                {t('lang.it')}
              </Chip>
              <Chip selected={locale === 'en'} onClick={() => setLocale('en')}>
                {t('lang.en')}
              </Chip>
            </div>
          </div>

          {error ? <p className="text-sm text-error">{error}</p> : null}

          <div className="flex items-center gap-4">
            <Button variant="primary" disabled={saving} onClick={save}>
              {t('profile.save')}
            </Button>
            <Button variant="ghost" disabled={saving} onClick={cancel}>
              {t('profile.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      <Toast message={t('profile.saved')} show={toast} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </h2>
  );
}

/** A labelled profile block with a visibility control shown only in edit mode. */
function Section({
  label,
  visibilityField,
  editing,
  vis,
  setVis,
  t,
  children,
}: {
  label: string;
  visibilityField: string;
  editing: boolean;
  vis: (field: string) => Visibility;
  setVis: (field: string, value: Visibility) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        {editing ? (
          <div role="group" aria-label={t('profile.visibility.label')} className="flex gap-1.5">
            {VISIBILITY_OPTIONS.map((opt) => (
              <Chip
                key={opt}
                selected={vis(visibilityField) === opt}
                onClick={() => setVis(visibilityField, opt)}
                className="px-3 py-1 text-[11px]"
              >
                {t(`visibility.${opt}` as MessageKey)}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </Card>
  );
}
