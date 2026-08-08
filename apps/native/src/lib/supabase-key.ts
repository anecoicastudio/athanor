/**
 * Which Supabase API key the app authenticates with.
 *
 * The project has migrated to the new key system: `sb_publishable_…` replaces the legacy
 * `anon` JWT, which Supabase deprecates by the end of 2026 and which stops working the
 * moment the legacy JWT secret is revoked (the legacy keys ARE JWTs signed by it, and the
 * project's signing key is already asymmetric ES256 with the old HS256 secret on standby).
 *
 * Both are read so one bundle runs before and after the switch: ship a build carrying the
 * publishable key, verify, then disable the legacy keys — no forced update in between.
 * Drop the `anon` arm once no build in the wild depends on it.
 *
 * Split out of supabase.ts because that module calls createClient and AppState at import
 * time and cannot be loaded under the node test environment.
 */

const present = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';

export function resolveSupabaseKey(env: { publishable?: string; anon?: string }): string {
  if (present(env.publishable)) return env.publishable;
  if (present(env.anon)) return env.anon;
  throw new Error(
    'Missing Supabase API key: set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (preferred) or ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY. Local runs read apps/native/.env; EAS cloud builds do ' +
      'NOT — they read EAS environment variables for the profile named in eas.json.',
  );
}
