/**
 * Version-gate backstop (RELEASE-RUNBOOK §6.4). Every request carries the build's
 * version + platform; edge functions reject unsupported builds with 426. The fetch
 * wrapper in supabase.ts is the single interception point — this module holds the
 * decision, so it stays reachable without loading the Supabase client.
 *
 * Only `/functions/v1/` responses count: a 426 from anywhere else is not the gate
 * speaking, and must never strand the user on ForceUpdateScreen.
 */
const EDGE_FUNCTION_PATH = '/functions/v1/';

/** HTTP 426 Upgrade Required — the gate's rejection code. */
const UPGRADE_REQUIRED = 426;

/** True when this response is the version gate rejecting the build. */
export function isVersionGateRejection(response: { status: number }, url: string): boolean {
  if (response.status !== UPGRADE_REQUIRED) return false;
  return url.includes(EDGE_FUNCTION_PATH);
}

/** Normalize the three `fetch` input forms to the request URL string. */
export function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
