'use client';

import { useState } from 'react';
import { t } from '@kaira/i18n';
import { createClient } from '@/utils/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  // /auth/confirm redirects here with ?error=invalid_link on expired/bad links
  const [expired] = useState(
    () => typeof window !== 'undefined' && window.location.search.includes('error=invalid_link'),
  );

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    setState(error ? 'error' : 'sent');
  };

  if (state === 'sent') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-blu-notte px-6">
        <h1 className="text-3xl text-avorio">{t('auth.sent.title', 'it')}</h1>
        <p className="text-muted-foreground">{t('auth.sent.body', 'it')}</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-blu-notte px-6">
      <h1 className="max-w-xl text-center text-5xl text-avorio">{t('auth.welcome.title', 'it')}</h1>
      {expired ? <p className="text-sm text-error">{t('auth.error.invalidLink', 'it')}</p> : null}
      <form onSubmit={sendLink} className="flex w-full max-w-sm flex-col gap-4">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t('auth.email.label', 'it')}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@esempio.it"
            className="mt-2 w-full rounded-full border border-border bg-card px-5 py-3 text-avorio placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-avorio"
          />
        </label>
        {state === 'error' ? (
          <p className="text-sm text-error">{t('auth.error.generic', 'it')}</p>
        ) : null}
        <button
          type="submit"
          disabled={state === 'sending'}
          className="h-12 rounded-full bg-avorio font-semibold tracking-widest text-blu-notte disabled:opacity-60"
        >
          {t('auth.email.cta', 'it')}
        </button>
      </form>
    </main>
  );
}
