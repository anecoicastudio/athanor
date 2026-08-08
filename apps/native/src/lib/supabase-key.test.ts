import { describe, expect, it } from 'vitest';
import { resolveSupabaseKey } from './supabase-key';

describe('resolveSupabaseKey', () => {
  it('prefers the publishable key when both are present', () => {
    expect(
      resolveSupabaseKey({ publishable: 'sb_publishable_abc', anon: 'eyJhbGciOiJIUzI1NiJ9.x' }),
    ).toBe('sb_publishable_abc');
  });

  it('falls back to the legacy anon key while the project still issues one', () => {
    expect(resolveSupabaseKey({ anon: 'eyJhbGciOiJIUzI1NiJ9.x' })).toBe('eyJhbGciOiJIUzI1NiJ9.x');
  });

  // An unset EXPO_PUBLIC_* is inlined by Metro as the empty string in some setups and as
  // undefined in others — neither may be handed to createClient as a real key.
  it.each([undefined, '', '   '])('treats %o as absent', (blank) => {
    expect(resolveSupabaseKey({ publishable: blank, anon: 'anon-key' })).toBe('anon-key');
  });

  it('throws naming both variables when neither is set', () => {
    expect(() => resolveSupabaseKey({})).toThrow(
      /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.*EXPO_PUBLIC_SUPABASE_ANON_KEY/s,
    );
  });

  it('mentions EAS in the failure, because that is where the key is actually missing', () => {
    // A cloud build reads EAS environment variables, never the gitignored .env — the most
    // likely way to hit this error is a build profile with no environment configured.
    expect(() => resolveSupabaseKey({})).toThrow(/EAS/);
  });
});
