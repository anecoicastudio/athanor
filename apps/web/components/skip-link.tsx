'use client';

import { t } from '@athanor/i18n';
import { useLocale } from '@/components/locale-provider';

/**
 * Skip-to-content link — first focusable element in the body. Client-side so its
 * label follows the locale toggle; the layout above it is prerendered as IT and
 * cannot re-render on a switch.
 */
export function SkipLink() {
  const { locale } = useLocale();
  return (
    <a href="#main" className="skip-link">
      {t('a11y.skip', locale)}
    </a>
  );
}
