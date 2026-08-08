import type { MetadataRoute } from 'next';
import { t } from '@athanor/i18n';
import { semantic } from '@athanor/config';

/**
 * PWA manifest — installable, themed to the dark canvas. Icons point at the
 * `/icon` + `/apple-icon` ImageResponse routes. Copy + colors come from
 * @athanor/i18n / @athanor/config (no hardcoded strings or literal hex).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t('app.name', 'it'),
    short_name: t('app.name', 'it'),
    description: t('landing.meta.description', 'it'),
    start_url: '/',
    display: 'standalone',
    background_color: semantic.background,
    theme_color: semantic.background,
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
