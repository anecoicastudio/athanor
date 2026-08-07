import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json } from './respond.ts';

/**
 * Server-side backstop for the client BootGate (RELEASE-RUNBOOK §6.4): reject requests
 * from builds below `remote_config.min_app_version` with 426 so an outdated client that
 * dodged the client gate (offline boot, first install) still can't perform privileged
 * actions. COURTESY CHECK ONLY: the headers are client-supplied and trivially forged —
 * real invariants stay behind RLS and the service-role gates, never behind this.
 * Fail-open on every doubt (missing headers, DB error, malformed config): availability
 * over enforcement — this gate must never take check-in or payments down.
 */

export type MinAppVersion = { ios: string; android: string };

/**
 * Mirror of packages/core/src/boot/version.ts (edge functions can't import workspace
 * packages). Keep the two in sync — same per-segment compare, same fail-open contract.
 */
export function isVersionBelow(
  current: string | null | undefined,
  min: string | null | undefined,
): boolean {
  const a = parseVersion(current);
  const b = parseVersion(min);
  if (!a || !b) return false; // fail-open
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const parts = v.split('.');
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(Number(p));
  }
  return nums.length ? nums : null;
}

export function evaluateVersionGate(input: {
  version: string | null;
  platform: string | null;
  min: MinAppVersion | null;
}): 'ok' | 'outdated' {
  if (!input.min) return 'ok';
  if (input.platform !== 'ios' && input.platform !== 'android') return 'ok';
  const min = input.min[input.platform];
  return isVersionBelow(input.version, min) ? 'outdated' : 'ok';
}

// Per-isolate cache of the min_app_version row — one PK select per isolate per TTL,
// so a config flip propagates to edge enforcement within ~60s (same window as the
// client staleTime).
const CACHE_TTL_MS = 60_000;
let cache: { min: MinAppVersion | null; fetchedAt: number } | null = null;

export function _resetVersionGateCacheForTest(): void {
  cache = null;
}

function parseMin(value: unknown): MinAppVersion | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.ios !== 'string' || typeof v.android !== 'string') return null;
  return { ios: v.ios, android: v.android };
}

async function readMinAppVersion(client: SupabaseClient): Promise<MinAppVersion | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.min;
  const { data, error } = await client
    .from('remote_config')
    .select('value')
    .eq('key', 'min_app_version')
    .maybeSingle();
  if (error) return null; // fail-open; don't poison the cache with an outage
  const min = parseMin((data as { value?: unknown } | null)?.value);
  cache = { min, fetchedAt: Date.now() };
  return min;
}

export async function requireSupportedVersion(
  req: Request,
  client: SupabaseClient,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const version = req.headers.get('x-app-version');
  const platform = req.headers.get('x-app-platform');
  if (!version || !platform) return { ok: true }; // fail-open: old builds / curl without headers

  const min = await readMinAppVersion(client);
  if (evaluateVersionGate({ version, platform, min }) === 'outdated') {
    const minVersion = platform === 'ios' ? min!.ios : min!.android;
    return { ok: false, response: json({ error: 'outdated_client', minVersion }, 426) };
  }
  return { ok: true };
}
