'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { t, type Locale } from '@athanor/i18n';
import { Button } from '@/components/ui/button';

/**
 * Pre-launch email capture — replaces the inert "coming soon" store badges.
 * Posts to /api/waitlist (stores in Supabase + notifies athanor@gmail.com via
 * Resend). Copy is i18n; the success/duplicate state shows the ✦ mark but stays
 * in foreground — cyan is reserved for the Dai-Vita star (DESIGN.md §4). `source`
 * tags where on the page the signup happened.
 */
type Status = 'idle' | 'loading' | 'success' | 'duplicate' | 'error' | 'invalid';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistForm({
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
        setStatus(res.status === 400 ? 'invalid' : 'error');
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
    <div className={`flex w-full max-w-sm flex-col gap-3 ${className ?? ''}`}>
      {done ? (
        <p className="text-base font-medium text-foreground">
          {t(
            status === 'duplicate' ? 'landing.waitlist.duplicate' : 'landing.waitlist.success',
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
            placeholder={t('landing.waitlist.placeholder', locale)}
            aria-label={t('landing.waitlist.placeholder', locale)}
            className="h-12 flex-1 rounded-full border border-border bg-card/40 px-5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <Button type="submit" disabled={status === 'loading'}>
            {t('landing.waitlist.cta', locale)}
          </Button>
        </form>
      )}
      {status === 'invalid' && (
        <p className="text-sm text-muted-foreground">{t('landing.waitlist.invalid', locale)}</p>
      )}
      {status === 'error' && (
        <p className="text-sm text-muted-foreground">{t('landing.waitlist.error', locale)}</p>
      )}
      {!done && (
        <p className="text-xs text-muted-foreground">
          {t('landing.waitlist.privacy', locale)}{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:opacity-80">
            {t('legal.privacy', locale)}
          </Link>
        </p>
      )}
    </div>
  );
}
