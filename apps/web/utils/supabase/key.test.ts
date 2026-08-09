import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseKey } from './key';

/**
 * mobile.md's rule, in its Next form: publishable preferred, legacy anon accepted while it
 * still exists, and a hard throw when neither is set — a missing key must fail at boot rather
 * than produce a client that 401s every request.
 *
 * These reads must stay literal member expressions because Next inlines NEXT_PUBLIC_* at build
 * time; that property is asserted from the source in `no computed env read` below.
 */
afterEach(() => vi.unstubAllEnvs());

describe('supabaseKey', () => {
  it('prefers the publishable key when both are present', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_aaa');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy_anon_bbb');
    expect(supabaseKey()).toBe('sb_publishable_aaa');
  });

  it('falls back to the legacy anon key when only it is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy_anon_bbb');
    expect(supabaseKey()).toBe('legacy_anon_bbb');
  });

  it('throws when neither is set, naming both variables', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    // The message has to name the variables: this fires in a Vercel build where the only
    // diagnostic anyone sees is the thrown string.
    expect(() => supabaseKey()).toThrow(/NEXT_PUBLIC_SUPABASE_(PUBLISHABLE|ANON)_KEY/);
  });

  it('refuses a secret key pasted into the publishable variable', () => {
    // NEXT_PUBLIC_* is inlined into the browser bundle, so a pasted sb_secret_… is a leak,
    // not a misconfiguration. It must throw rather than be returned.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_oops');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    expect(() => supabaseKey()).toThrow(/secret/i);
  });

  it('refuses a secret key pasted into the legacy anon variable too', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_oops');
    expect(() => supabaseKey()).toThrow(/secret/i);
  });

  it('does not fall through to the anon key when the publishable one is a secret', () => {
    // Falling back would turn a loud leak into a silent one that works.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_oops');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy_anon_bbb');
    expect(() => supabaseKey()).toThrow(/secret/i);
  });
});
