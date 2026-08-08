'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';

const KEY = 'athanor-cookie-ack';

/**
 * Minimal, non-blocking cookie/privacy notice. The landing only sets the
 * functional `athanor_locale` cookie and uses cookieless analytics, so a brief
 * dismissible notice (not a consent gate) is sufficient. Renders nothing until
 * mounted, so SSR and first client paint agree (no hydration flash).
 */
export function CookieNotice() {
  const { locale } = useLocale();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      // Defer to avoid react-hooks/set-state-in-effect (synchronous setState).
      if (!localStorage.getItem(KEY)) queueMicrotask(() => setShow(true));
    } catch {
      /* storage blocked — stay hidden */
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-3 border-t border-border bg-background/95 px-6 py-4 text-center text-sm text-muted-foreground backdrop-blur sm:flex-row sm:justify-center">
      <p className="max-w-xl">
        {t('cookie.notice', locale)}{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          {t('legal.privacy', locale)}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-foreground transition-opacity hover:opacity-80"
      >
        {t('cookie.dismiss', locale)}
      </button>
    </div>
  );
}
