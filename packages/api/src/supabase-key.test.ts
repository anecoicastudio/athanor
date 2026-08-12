import { describe, expect, it } from 'vitest';
import { resolveSupabaseKey } from './supabase-key';

const WEB_VARS = {
  publishable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  anon: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
};

// apps/native passes this shape; the hint is the only reason the app kept its own copy
// of this function until #272 folded the two together.
const NATIVE_VARS = {
  publishable: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  anon: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  hint: 'Local runs read apps/native/.env; EAS cloud builds do NOT.',
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

  it('refuses a pasted secret key in either slot', () => {
    expect(() => resolveSupabaseKey({ publishable: 'sb_secret_oops' }, WEB_VARS)).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.*sb_secret_/s,
    );
    expect(() => resolveSupabaseKey({ anon: 'sb_secret_oops' }, WEB_VARS)).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY.*sb_secret_/s,
    );
  });

  // A cloud build reads EAS environment variables, never the gitignored .env — the most
  // likely way to hit this error is a build profile with no environment configured, so the
  // native caller's hint has to survive into the message.
  it('appends the caller hint to the missing-key failure', () => {
    expect(() => resolveSupabaseKey({}, NATIVE_VARS)).toThrow(
      /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.*EXPO_PUBLIC_SUPABASE_ANON_KEY.*EAS/s,
    );
  });

  it('omits the trailing space when no hint is given', () => {
    expect(() => resolveSupabaseKey({}, WEB_VARS)).toThrow(/fallback\)\.$/);
  });
});
