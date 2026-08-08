/**
 * Which Supabase API key a client app authenticates with.
 *
 * The project has migrated to the new key system: `sb_publishable_…` replaces the legacy
 * `anon` JWT, which Supabase deprecates by the end of 2026 and which stops working the
 * moment the legacy JWT secret is revoked. Both are read so one deploy spans the switch:
 * ship with the publishable key, verify, then disable the legacy keys — no gap in between.
 * Drop the `anon` arm once nothing in the wild depends on it.
 *
 * Env-var NAMES are parameters because each app reads its own pair (web:
 * `NEXT_PUBLIC_SUPABASE_*`, native: `EXPO_PUBLIC_SUPABASE_*`) and the error must name the
 * variables the caller actually has to set. The VALUES must be read by the caller as
 * literal member expressions — both Metro and Next inline their public env vars at bundle
 * time, so a computed lookup silently yields undefined.
 *
 * apps/native/src/lib/supabase-key.ts predates this module and keeps its own copy with an
 * EAS-specific error message; folding it into this one is a pending dedup.
 */

const present = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';

// These vars ship to the browser: refuse a pasted secret key outright rather than
// letting the bundler inline it into a public chunk (rule 8 defense-in-depth).
const guard = (v: string, name: string): string => {
  if (v.startsWith('sb_secret_')) {
    throw new Error(
      `${name} holds an sb_secret_… key — secret keys must never reach a client app.`,
    );
  }
  return v;
};

export function resolveSupabaseKey(
  env: { publishable?: string; anon?: string },
  vars: { publishable: string; anon: string },
): string {
  if (present(env.publishable)) return guard(env.publishable, vars.publishable);
  if (present(env.anon)) return guard(env.anon, vars.anon);
  throw new Error(
    `Missing Supabase API key: set ${vars.publishable} (preferred, sb_publishable_…) or ` +
      `${vars.anon} (legacy anon fallback).`,
  );
}
