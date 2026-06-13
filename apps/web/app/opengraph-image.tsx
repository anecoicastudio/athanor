import { ImageResponse } from 'next/og';
import { t } from '@auria/i18n';
import { semantic } from '@auria/config';
import { mandorlaDataUri } from '@/lib/mandorla-svg';

/**
 * Social share card (1200×630) — the mandorla + AURIA wordmark + tagline on the
 * dark canvas. Auto-wired as `og:image` and the Twitter image. Built from the
 * IT canonical copy (crawlers have no locale cookie). Colors via @auria/config.
 */
export const alt = 'Auria — dove ogni incontro si accende';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
        background: semantic.background,
        color: semantic.foreground,
      }}
    >
      <img src={mandorlaDataUri(3.2)} width={196} height={196} alt="" />
      <div style={{ display: 'flex', fontSize: 92, letterSpacing: 34, paddingLeft: 34 }}>
        {t('app.name', 'it').toUpperCase()}
      </div>
      <div
        style={{ display: 'flex', fontSize: 30, letterSpacing: 4, color: semantic.foregroundMuted }}
      >
        {t('app.tagline', 'it')}
      </div>
    </div>,
    { ...size },
  );
}
