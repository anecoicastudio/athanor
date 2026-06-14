import type { Locale } from '@auria/schemas';

/**
 * The device UI language, narrowed to a supported Auria `Locale` (defaults to
 * Italian). Single source for the pre-auth screens (welcome, check-email, the
 * onboarding funnel, BrandSplash) that pick copy before a profile locale exists.
 */
export const deviceLocale: Locale = (
  Intl.DateTimeFormat().resolvedOptions().locale ?? 'it'
).startsWith('en')
  ? 'en'
  : 'it';
