'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { t, type Locale } from '@athanor/i18n';
import { Button } from '@/components/ui/button';

/**
 * The «updates» form in the landing footer (2026-10-03): an e-mail address for news about
 * Athanor — features, new countries, events — from someone not ready to install. It sits under
 * the store badges and is deliberately the quieter of the two: the badges are the action.
 *
 * The capture path is the pre-launch waitlist's, unchanged: it posts to /api/waitlist, which
 * stores in `email_waitlist` (no operator email — see issue #23). What tells an updates
 * subscriber from a waitlist address is the `source` tag and the date; the privacy policy
 * (`lib/legal-content.ts`) promises the two different things, so never write an old tag here.
 * The success/duplicate state shows the ✦ mark but stays in foreground — cyan is reserved for
 * the Dai-Vita star (DESIGN.md §4).
 *
 * A 429 gets its own state (issue #23). The route answers one when the database throttle
 * refuses, and collapsing it into `error` would tell someone the site is broken when it is
 * asking them to wait — which is the same false claim the honest 429 exists to avoid, just
 * moved one layer up.
 */
type Status = 'idle' | 'loading' | 'success' | 'duplicate' | 'error' | 'invalid' | 'rateLimited';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UpdatesForm({
  locale,
  source,
  className,
}: {
  locale: Locale;
  source?: string;
  className?: string;
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  // Honeypot — a hidden field humans never see. A non-empty value means a bot
  // filled it; the endpoint silently no-ops so the count stays trustworthy.
  const [company, setCompany] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setStatus('invalid');
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, locale, source, company }),
      });
      if (!res.ok) {
        if (res.status === 400) setStatus('invalid');
        else if (res.status === 429) setStatus('rateLimited');
        else setStatus('error');
        return;
      }
      const data: { duplicate?: boolean } = await res.json();
      setStatus(data.duplicate ? 'duplicate' : 'success');
    } catch {
      setStatus('error');
    }
  }

  const done = status === 'success' || status === 'duplicate';

  return (
    <div className={`flex w-full max-w-md flex-col gap-3 ${className ?? ''}`}>
      {!done && (
        <p className="text-sm font-medium text-foreground">{t('landing.updates.label', locale)}</p>
      )}
      {done ? (
        <p className="text-base font-medium text-foreground">
          {t(
            status === 'duplicate' ? 'landing.updates.duplicate' : 'landing.updates.success',
            locale,
          )}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
          {/* honeypot: off-screen, never tabbable, hidden from a11y tree */}
          <input
            type="text"
            name="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute left-[-9999px] h-0 w-0 opacity-0"
          />
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status !== 'idle') setStatus('idle');
            }}
            placeholder={t('landing.updates.placeholder', locale)}
            aria-label={t('landing.updates.placeholder', locale)}
            className="h-12 flex-1 rounded-full border border-border bg-card/40 px-5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          {/* Outlined, not the light fill: the store badges above are the action here. */}
          <Button
            type="submit"
            disabled={status === 'loading'}
            className="shrink-0 whitespace-nowrap border border-border bg-transparent text-foreground"
          >
            {t('landing.updates.cta', locale)}
          </Button>
        </form>
      )}
      {status === 'invalid' && (
        <p className="text-sm text-muted-foreground">{t('landing.updates.invalid', locale)}</p>
      )}
      {status === 'error' && (
        <p className="text-sm text-muted-foreground">{t('landing.updates.error', locale)}</p>
      )}
      {status === 'rateLimited' && (
        <p className="text-sm text-muted-foreground">{t('landing.updates.rateLimited', locale)}</p>
      )}
      {!done && (
        <p className="text-xs text-muted-foreground">
          {t('landing.updates.privacy', locale)}{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:opacity-80">
            {t('legal.privacy', locale)}
          </Link>
        </p>
      )}
    </div>
  );
}
