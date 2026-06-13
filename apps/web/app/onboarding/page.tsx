'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  createDream,
  isHandleAvailable,
  type KairaClient,
  updateOnboardingProfile,
} from '@kaira/api';
import { IDENTITY_TAGS, SEEKING_TAGS, suggestHandle, validateOnboardingAnswers } from '@kaira/core';
import { t, type MessageKey } from '@kaira/i18n';
import { onboardingAnswersSchema, type Locale } from '@kaira/schemas';
import { createClient } from '@/utils/supabase/client';

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        selected
          ? 'rounded-full bg-luce px-5 py-2.5 font-semibold text-notte'
          : 'rounded-full border border-border bg-card px-5 py-2.5 text-luce'
      }
    >
      {label}
    </button>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  // Initialized inside a .then() callback to satisfy react-hooks/set-state-in-effect;
  // createClient() never runs during SSR prerender because useEffect is client-only.
  const [supabase, setSupabase] = useState<KairaClient | null>(null);
  const [step, setStep] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [locale, setLocale] = useState<Locale>('it');
  // resolvedHandle: the handle that handleAvailability was last resolved for
  const [resolvedHandle, setResolvedHandle] = useState<string>('');
  const [handleAvailability, setHandleAvailability] = useState<'free' | 'taken' | 'unknown'>(
    'unknown',
  );

  const handleFormatOk = useMemo(() => /^[a-z0-9_]{3,30}$/.test(handle), [handle]);
  const handleStatus = useMemo<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>(() => {
    if (!handle) return 'idle';
    if (!handleFormatOk) return 'invalid';
    // async result is fresh only when it was resolved for the current handle
    if (resolvedHandle !== handle) return 'checking';
    // fetch error: resolvedHandle matches but availability unknown → idle (retryable, Avanti disabled)
    if (handleAvailability === 'unknown') return 'idle';
    return handleAvailability === 'free' ? 'free' : 'taken';
  }, [handle, handleFormatOk, resolvedHandle, handleAvailability]);
  const [identity, setIdentity] = useState<string[]>([]);
  const [seeking, setSeeking] = useState<string[]>([]);
  const [dream, setDream] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = createClient();
    client.auth.getUser().then(({ data }) => {
      setSupabase(client);
      setUserId(data.user?.id ?? null);
      const email = data.user?.email;
      if (email) setHandle((h) => h || suggestHandle(email));
      setLocale(navigator.language.startsWith('en') ? 'en' : 'it');
    });
  }, []);

  // debounced live availability check (UX pre-check; DB unique constraint is the real guard)
  useEffect(() => {
    if (!handleFormatOk || !supabase) return;
    let cancelled = false;
    const id = setTimeout(() => {
      isHandleAvailable(supabase, handle)
        .then((free) => {
          if (!cancelled) {
            setHandleAvailability(free ? 'free' : 'taken');
            setResolvedHandle(handle);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHandleAvailability('unknown');
            setResolvedHandle(handle);
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [handle, handleFormatOk, supabase]);

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((x) => x !== tag) : [...list, tag]);

  const canNext = useMemo(() => {
    if (step === 0) return handleStatus === 'free';
    if (step === 1) return identity.length > 0;
    if (step === 2) return seeking.length > 0;
    return true;
  }, [step, handleStatus, identity, seeking]);

  const finish = async (plantDream: boolean) => {
    if (!userId || !supabase) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = onboardingAnswersSchema.parse({
        handle,
        locale,
        identity_tags: identity,
        seeking,
      });
      const vocab = validateOnboardingAnswers(answers);
      if (!vocab.ok) throw new Error(vocab.field);
      await updateOnboardingProfile(supabase, userId, answers);
      if (plantDream && dream.trim()) {
        await createDream(supabase, { profile_id: userId, text: dream.trim() });
      }
      router.replace('/profilo');
    } catch {
      setError(t('onboarding.error.submit', locale));
    } finally {
      setSubmitting(false);
    }
  };

  const tagLabel = (prefix: 'tag.identity' | 'tag.seeking', key: string) =>
    t(`${prefix}.${key}` as MessageKey, locale);

  const titles: MessageKey[] = [
    'onboarding.handle.title',
    'onboarding.identity.title',
    'onboarding.seeking.title',
    'onboarding.dream.title',
  ];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-notte px-6">
      <div className="flex w-full max-w-md items-center justify-between">
        <div className="flex gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i <= step ? 'bg-luce' : 'bg-border'}`}
            />
          ))}
        </div>
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={submitting}
            aria-label={t('onboarding.back', locale)}
            className="text-muted-foreground"
          >
            ←
          </button>
        ) : null}
      </div>
      <h1 className="text-4xl text-luce">{t(titles[step]!, locale)}</h1>

      <div className="flex w-full max-w-md flex-col gap-4">
        {step === 0 ? (
          <>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder={t('onboarding.handle.placeholder', locale)}
              className="w-full rounded-full border border-border bg-card px-5 py-3 text-luce placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-luce"
            />
            {handleStatus === 'taken' ? (
              <p className="text-sm text-error">{t('onboarding.handle.taken', locale)}</p>
            ) : null}
            {handleStatus === 'invalid' ? (
              <p className="text-sm text-error">{t('onboarding.handle.invalid', locale)}</p>
            ) : null}
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t('onboarding.locale.label', locale)}
            </p>
            <div className="flex gap-3">
              <Chip label="Italiano" selected={locale === 'it'} onClick={() => setLocale('it')} />
              <Chip label="English" selected={locale === 'en'} onClick={() => setLocale('en')} />
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-wrap gap-3">
            {IDENTITY_TAGS.map((tag) => (
              <Chip
                key={tag}
                label={tagLabel('tag.identity', tag)}
                selected={identity.includes(tag)}
                onClick={() => toggle(identity, setIdentity, tag)}
              />
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-wrap gap-3">
            {SEEKING_TAGS.map((tag) => (
              <Chip
                key={tag}
                label={tagLabel('tag.seeking', tag)}
                selected={seeking.includes(tag)}
                onClick={() => toggle(seeking, setSeeking, tag)}
              />
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <textarea
            maxLength={500}
            rows={5}
            value={dream}
            onChange={(e) => setDream(e.target.value)}
            placeholder={t('onboarding.dream.placeholder', locale)}
            className="w-full rounded-3xl border border-border bg-card px-5 py-4 text-luce placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-luce"
          />
        ) : null}

        {error ? <p className="text-sm text-error">{error}</p> : null}

        {step < 3 ? (
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setStep((s) => s + 1)}
            className="h-12 rounded-full bg-luce font-semibold tracking-widest text-notte disabled:opacity-40"
          >
            {t('onboarding.next', locale)}
          </button>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              disabled={submitting || !dream.trim()}
              onClick={() => finish(true)}
              className="h-12 w-full rounded-full bg-stella font-semibold tracking-widest text-notte disabled:opacity-40"
            >
              ✦ {t('onboarding.dream.submit', locale)}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => finish(false)}
              className="tracking-widest text-muted-foreground underline-offset-4 hover:underline"
            >
              {t('onboarding.dream.later', locale)}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
