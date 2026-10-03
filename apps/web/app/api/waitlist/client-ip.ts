/**
 * The visitor's address, for the waitlist throttle's per-client budget (issue #23).
 *
 * This has to be read HERE and forwarded to Supabase, because the insert happens inside a
 * serverless function: the request PostgREST receives is the function's, not the browser's.
 * Without forwarding, the trigger would key on the function's egress IP — a handful of regional
 * addresses shared by every visitor — and the per-client budget would silently be a site-wide
 * one, with real users throttling each other off.
 *
 * Order matters, and it is a security property rather than a preference. `cf-connecting-ip` is
 * set by the Cloudflare edge from the connection it terminated and is stripped-and-replaced on
 * ingress, so a caller cannot forge it. It must be consulted FIRST: Cloudflare *appends* the
 * real client to `x-forwarded-for`, which makes the leftmost XFF entry whatever the caller
 * sent — reading that first would hand the attacker the throttle key and undo issue #23
 * entirely. `x-vercel-forwarded-for` is a dormant fallback — nothing is served from Vercel
 * any more, and Workers never set it — kept only so this stays correct if that changes.
 *
 * The remaining fallbacks are still client-supplied and forgeable, which is why the throttle is
 * a COST control and not an authorization boundary: rotating the header defeats the per-client
 * budget. What it buys is that the trivial attack — one script, one fresh address per request —
 * stops being free. A WAF rule in front is still worth having (and rate limiting is available
 * on Cloudflare's free plan).
 *
 * With no header at all every caller shares the `unknown` key, so a proxy that strips these
 * makes the budget stricter rather than absent. That is the right direction to fail.
 */
export function clientIp(req: Request): string {
  const pick = (name: string) => {
    const raw = req.headers?.get?.(name);
    const first = raw?.split(',')[0]?.trim();
    return first || null;
  };
  return (
    pick('cf-connecting-ip') ??
    pick('x-vercel-forwarded-for') ??
    pick('x-forwarded-for') ??
    pick('x-real-ip') ??
    'unknown'
  );
}
