'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { t } from '@kaira/i18n';
import { createClient } from '@/utils/supabase/client';

function LoginForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get('error') === 'invalid_link';
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [wait, setWait] = useState(60);
  const [resendError, setResendError] = useState(false);

  useEffect(() => {
    if (state !== 'sent' || wait <= 0) return;
    const id = setInterval(() => setWait((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [state, wait]);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (!error) setWait(60);
    setState(error ? 'error' : 'sent');
  };

  const resend = async () => {
    setResendError(false);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      setResendError(true);
      return;
    }
    setWait(60);
  };

  if (state === 'sent') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-notte px-6">
        <h1 className="text-3xl text-luce">{t('auth.sent.title', 'it')}</h1>
        <p className="text-muted-foreground">{t('auth.sent.body', 'it')}</p>
        <button
          type="button"
          disabled={wait > 0}
          onClick={resend}
          className="text-muted-foreground underline-offset-4 hover:underline disabled:opacity-60"
        >
          {wait > 0
            ? t('auth.sent.wait', 'it').replace('{seconds}', String(wait))
            : t('auth.sent.resend', 'it')}
        </button>
        {resendError ? <p className="text-sm text-error">{t('auth.error.generic', 'it')}</p> : null}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-notte px-6">
      <h1 className="max-w-xl text-center text-5xl text-luce">{t('auth.welcome.title', 'it')}</h1>
      {expired ? <p className="text-sm text-error">{t('auth.error.invalidLink', 'it')}</p> : null}
      <form onSubmit={sendLink} className="flex w-full max-w-sm flex-col gap-4">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('auth.email.label', 'it')}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.email.placeholder', 'it')}
            className="mt-2 w-full rounded-full border border-border bg-card px-5 py-3 text-luce placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-luce"
          />
        </label>
        {state === 'error' ? (
          <p className="text-sm text-error">{t('auth.error.generic', 'it')}</p>
        ) : null}
        <button
          type="submit"
          disabled={state === 'sending'}
          className="h-12 rounded-full bg-luce font-semibold tracking-widest text-notte disabled:opacity-60"
        >
          {t('auth.email.cta', 'it')}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
