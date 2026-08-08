import { describe, expect, it } from 'vitest';
import { resolveSupabaseKey } from './supabase-key';

const WEB_VARS = {
  publishable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  anon: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
};

describe('resolveSupabaseKey', () => {
  it('prefers the publishable key when both are present', () => {
    expect(
      resolveSupabaseKey(
        { publishable: 'sb_publishable_abc', anon: 'eyJhbGciOiJIUzI1NiJ9.x' },
        WEB_VARS,
      ),
    ).toBe('sb_publishable_abc');
  });

  it('falls back to the legacy anon key while the project still issues one', () => {
    expect(resolveSupabaseKey({ anon: 'eyJhbGciOiJIUzI1NiJ9.x' }, WEB_VARS)).toBe(
      'eyJhbGciOiJIUzI1NiJ9.x',
    );
  });

  // An unset public env var is inlined by the bundler as the empty string in some setups
  // and as undefined in others — neither may be handed to createClient as a real key.
  it.each([undefined, '', '   '])('treats %o as absent', (blank) => {
    expect(resolveSupabaseKey({ publishable: blank, anon: 'anon-key' }, WEB_VARS)).toBe('anon-key');
  });

  it('throws naming both variables exactly as the caller passed them', () => {
    expect(() => resolveSupabaseKey({}, WEB_VARS)).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.*NEXT_PUBLIC_SUPABASE_ANON_KEY/s,
    );
    expect(() => resolveSupabaseKey({}, { publishable: 'FOO_PUB', anon: 'FOO_ANON' })).toThrow(
      /FOO_PUB.*FOO_ANON/s,
    );
  });
});
