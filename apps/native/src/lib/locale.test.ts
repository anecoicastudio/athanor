import { describe, expect, it } from 'vitest';
import { deviceLocale } from './locale';

describe('deviceLocale', () => {
  // The module's whole contract: whatever the device reports, the result is one of the
  // two supported catalogs — pre-auth screens index i18n with it before a profile exists,
  // so an un-narrowed value would throw at the first t() call.
  it('narrows to a supported locale', () => {
    expect(['it', 'en']).toContain(deviceLocale);
  });
});
