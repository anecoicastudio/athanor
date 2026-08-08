'use client';
import { useState } from 'react';
import { t } from '@athanor/i18n';
import { createClient } from '@/utils/supabase/client';

// Internal admin screen: hardcode locale to 'it' (server-only getLocale() can't be called here).
const locale = 'it' as const;

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'sent' | 'error' | 'invalid'>('idle');

  // Primary: password sign-in. signInWithPassword returns a session directly via the
  // @supabase/ssr browser client (cookies set client-side), so no email round-trip.
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState('invalid');
      return;
    }
    window.location.assign('/admin');
  }

  // Fallback: magic link (PKCE → /admin/auth/callback exchanges the code).
  async function sendLink() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin/auth/callback` },
    });
    setState(error ? 'error' : 'sent');
  }

  function clearState() {
    if (state !== 'idle') setState('idle');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('admin.login.title', locale)}</h1>
      <p className="text-muted-foreground">{t('admin.login.sub', locale)}</p>
      {state === 'sent' ? (
        <p className="text-aura">{t('admin.login.sent', locale)}</p>
      ) : (
        <form onSubmit={signIn} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearState();
            }}
            aria-label={t('admin.login.email', locale)}
            placeholder={t('admin.login.email', locale)}
            className="rounded-[14px] border border-border bg-card px-4 py-3 text-foreground"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearState();
            }}
            aria-label={t('admin.login.password', locale)}
            placeholder={t('admin.login.password', locale)}
            className="rounded-[14px] border border-border bg-card px-4 py-3 text-foreground"
          />
          <button
            type="submit"
            className="rounded-[14px] bg-aura px-4 py-3 font-semibold text-on-aura"
          >
            {t('admin.login.passwordCta', locale)}
          </button>
          {state === 'invalid' && (
            <p className="text-error">{t('admin.login.badPassword', locale)}</p>
          )}
          {state === 'error' && <p className="text-error">{t('admin.login.error', locale)}</p>}
          <button
            type="button"
            onClick={sendLink}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            {t('admin.login.cta', locale)}
          </button>
        </form>
      )}
    </main>
  );
}
