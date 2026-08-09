/**
 * The visitor's address, for the waitlist throttle's per-client budget (issue #23).
 *
 * This has to be read HERE and forwarded to Supabase, because the insert happens inside a
 * Vercel function: the request PostgREST receives is the function's, not the browser's. Without
 * forwarding, the trigger would key on the function's egress IP — a handful of regional
 * addresses shared by every visitor — and the per-client budget would silently be a site-wide
 * one, with real users throttling each other off.
 *
 * `x-forwarded-for` is a comma-separated chain and the FIRST entry is the original client; each
 * proxy appends. `x-vercel-forwarded-for` is preferred where present because Vercel sets it from
 * the connection it terminated rather than from anything the caller sent.
 *
 * It is still client-supplied and forgeable, which is why the throttle is a COST control and
 * not an authorization boundary: rotating the header defeats the per-client budget. What it
 * buys is that the trivial attack — one script, one fresh address per request — stops being
 * free. A WAF rule in front is still worth having.
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
    pick('x-vercel-forwarded-for') ?? pick('x-forwarded-for') ?? pick('x-real-ip') ?? 'unknown'
  );
}
