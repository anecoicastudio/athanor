import type { Locale } from '@athanor/schemas';

/**
 * The device UI language, narrowed to a supported Athanor `Locale` (defaults to
 * Italian). Single source for the pre-auth screens (welcome, the onboarding
 * funnel, BrandSplash) that pick copy before a profile locale exists.
 */
export function narrowLocale(tag: string | undefined): Locale {
  return (tag ?? 'it').startsWith('en') ? 'en' : 'it';
}

export const deviceLocale: Locale = narrowLocale(Intl.DateTimeFormat().resolvedOptions().locale);
