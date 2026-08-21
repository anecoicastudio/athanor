import { describe, expect, it } from 'vitest';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import manifest from './manifest';

/**
 * The PWA manifest is the one place both rule 4 (tokens, never a literal hex) and rule 5 (no
 * hardcoded user-facing strings) get rendered outside the app shell — an installed icon's label
 * and splash colour come from here. Neither rule can fail loudly: a hardcoded hex renders fine,
 * and `t()` returns the key itself on a miss (#113), so a missing catalog entry installs an app
 * literally named «app.name».
 */
describe('manifest', () => {
  it('takes its name and description from the catalogs, not from source', () => {
    const m = manifest();
    expect(m.name).toBe(t('app.name', 'it'));
    expect(m.short_name).toBe(t('app.name', 'it'));
    expect(m.description).toBe(t('landing.meta.description', 'it'));
  });

  it('resolves those keys — a miss would install an app named after the key', () => {
    const m = manifest();
    expect(m.name).not.toBe('app.name');
    expect(m.description).not.toBe('landing.meta.description');
  });

  it('paints the dark canvas from the token, not a literal hex', () => {
    const m = manifest();
    expect(m.background_color).toBe(semantic.background);
    expect(m.theme_color).toBe(semantic.background);
  });

  it('installs standalone from the root', () => {
    const m = manifest();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
  });

  it('points both icons at the generated ImageResponse routes', () => {
    // These are routes, not files in public/ — a stale `.png` path 404s only once installed.
    expect(manifest().icons).toEqual([
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ]);
  });
});
