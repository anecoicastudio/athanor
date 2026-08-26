/**
 * Which Supabase API key an edge function authenticates with.
 *
 * The project has migrated to the new key system. The platform injects the new keys as
 * `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`, which hold a JSON object keyed by
 * key NAME — not the plain string the legacy `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
 * variables held. Reading them like the old ones yields `{"default":"sb_secret_…"}` as a key
 * and a 401 that looks like a permissions problem.
 *
 * Every accessor falls back to its legacy variable, so one deployed bundle runs unchanged
 * on: hosted with both key families live, hosted after the legacy keys are disabled, a local
 * `supabase start` that may only issue legacy keys, and CI where neither is injected. That
 * fallback IS the revert path — turning the legacy keys back on needs no redeploy.
 *
 * Secret keys are NOT JWTs. They authorize via the Postgres BYPASSRLS attribute, which is why
 * the platform's `verify_jwt` gate cannot validate one and every function that receives a
 * secret key must declare `verify_jwt = false` and gate itself (see _shared/auth.ts).
 */

/** Minimal env surface, injectable so tests never mutate the process environment. */
export type EnvPort = { get(name: string): string | undefined };

/**
 * The real process environment, and the default port every accessor here reads through.
 * Exported because _shared/stripe.ts needs the same adapter (#541) and two copies of it is
 * two places for the lazy-read property to be got wrong.
 */
export const denoEnv: EnvPort = { get: (name) => Deno.env.get(name) };

const present = (v: string | undefined | null): v is string =>
  typeof v === 'string' && v.trim() !== '';

/**
 * Parse a name-keyed JSON dictionary. Absent, blank, malformed, or non-object input yields
 * `{}` and non-string members are dropped — a bad injected value must degrade to the legacy
 * fallback, never throw at module scope and take the whole function down.
 */
export function parseKeyMap(raw: string | undefined | null): Record<string, string> {
  if (!present(raw)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (present(value as string)) out[name] = value as string;
  }
  return out;
}

/** `default` first (the name the CLI injects), then the rest by name for a stable order. */
function orderedValues(map: Record<string, string>): string[] {
  const names = Object.keys(map).sort();
  const ordered = names.includes('default')
    ? ['default', ...names.filter((n) => n !== 'default')]
    : names;
  return ordered.map((n) => map[n]);
}

/**
 * Every secret key this function will ACCEPT from an internal caller, most-preferred first,
 * with the legacy service-role key last.
 *
 * Accepting all of them (rather than one named key) is what makes rotation a dashboard-only
 * operation: create the new key → `vault.update_secret` the `app.settings.*_key` secrets →
 * verify → delete the old key, with no redeploy and no 401 window. (Vault since
 * `20260810103721_pg_net_config_via_vault`. They are not persistent GUCs: a hosted project
 * rejects `alter database/role … set` for any custom parameter with 42501. A session-level
 * `set_config` still works, which is what keeps the local stack and the pgTAP fixtures going.)
 * It costs no authority, because every secret key already carries BYPASSRLS — there is no
 * privilege separation between them. The revocation boundary is deleting the key in the
 * dashboard, which drops it from this list automatically.
 */
export function secretKeys(env: EnvPort = denoEnv): string[] {
  const keys = orderedValues(parseKeyMap(env.get('SUPABASE_SECRET_KEYS')));
  const legacy = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (present(legacy)) keys.push(legacy);
  return [...new Set(keys)];
}

/** The secret key this function PRESENTS on its own outbound service-to-service calls. */
export function secretKey(env: EnvPort = denoEnv): string {
  const [first] = secretKeys(env);
  if (!first) {
    throw new Error(
      'No Supabase secret key available: neither SUPABASE_SECRET_KEYS nor the legacy ' +
        'SUPABASE_SERVICE_ROLE_KEY is set. Both are injected by the platform — do not set them ' +
        'with `supabase secrets set`, the SUPABASE_ prefix is reserved.',
    );
  }
  return first;
}

/** The publishable key used to build a caller-scoped (RLS-bound) client. */
export function publishableKey(env: EnvPort = denoEnv): string {
  const [first] = orderedValues(parseKeyMap(env.get('SUPABASE_PUBLISHABLE_KEYS')));
  if (first) return first;
  const legacy = env.get('SUPABASE_ANON_KEY');
  if (present(legacy)) return legacy;
  throw new Error(
    'No Supabase publishable key available: neither SUPABASE_PUBLISHABLE_KEYS nor the legacy ' +
      'SUPABASE_ANON_KEY is set. Both are injected by the platform.',
  );
}
