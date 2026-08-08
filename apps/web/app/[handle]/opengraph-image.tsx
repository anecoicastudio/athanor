import { ImageResponse } from 'next/og';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';
import { getPublicProfileByHandle } from '@athanor/api';
import { resolveHandle } from '@/lib/resolve-handle';
import { createClient } from '@/utils/supabase/server';

/**
 * Per-handle OG image (1200×630) — embeds the dream quote (IT canonical, crawlers
 * have no locale cookie) + @handle + ATHANOR wordmark. Falls back to the app tagline
 * when the profile has no dream. Revalidates in sync with the page (5-min ISR).
 */
export const alt = 'Athanor';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 300; // ISR — keep the OG card in sync with the page

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const handle = resolveHandle(raw);
  const profile = handle ? await getPublicProfileByHandle(await createClient(), handle) : null;
  const quote = profile?.dream?.text ?? t('app.tagline', 'it');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 28,
        padding: 96,
        background: semantic.background,
        color: semantic.foreground,
      }}
    >
      <div style={{ display: 'flex', fontSize: 30, letterSpacing: 6, color: semantic.aura }}>
        @{profile?.handle ?? t('app.name', 'it')}
      </div>
      <div style={{ display: 'flex', fontSize: 56, fontStyle: 'italic', lineHeight: 1.2 }}>
        «{quote}»
      </div>
      <div
        style={{ display: 'flex', fontSize: 24, letterSpacing: 4, color: semantic.foregroundMuted }}
      >
        {t('app.name', 'it').toUpperCase()}
      </div>
    </div>,
    { ...size },
  );
}
