import { NextResponse } from 'next/server';
import { isWaitlistRateLimited, subscribeToWaitlist } from '@athanor/api';
import { waitlistInsertSchema } from '@athanor/schemas';
import { createClient } from '@/utils/supabase/server';
import { clientIp } from './client-ip';

/**
 * Pre-launch waitlist capture. Validates at the boundary (Zod), then stores the email in
 * `email_waitlist` via the anon client (RLS allows anon insert-only).
 *
 * Throttled in the database, not here: the `email_waitlist_throttle` BEFORE INSERT trigger
 * allows five signups per ten minutes per client address and raises `P0001
 * waitlist_rate_limited` past that (issue #23). This route's only job is to tell that refusal
 * apart from a real failure and answer 429 instead of 500 — a throttle nobody can bypass by
 * forgetting to call it, because there is nothing to call.
 *
 * There is deliberately NO per-signup email. It used to fire a Resend send to the operator for
 * every non-duplicate address, which meant one script with a fresh address each time mailbombed
 * the inbox and burned the quota — and the duplicate check was no defence, since the attacker
 * never repeats an address. Capping that send would have been weaker than not having it: read
 * the waitlist through the admin panel, or add a digest job. Capture is the product; the email
 * was a convenience with an unbounded downside.
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  // Honeypot: bots fill the hidden `company` field; humans leave it empty.
  // Return a benign success without storing so a bot can't tell it was rejected.
  // (waitlistInsertSchema strips unknown keys, so `company` never reaches the DB.)
  if (
    json &&
    typeof json === 'object' &&
    typeof (json as { company?: unknown }).company === 'string' &&
    (json as { company: string }).company.trim() !== ''
  ) {
    return NextResponse.json({ ok: true, duplicate: false });
  }
  const parsed = waitlistInsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  try {
    // The visitor's address, forwarded so PostgREST sees it instead of this function's egress
    // IP — without it the throttle's per-client budget is a site-wide one (see ./client-ip).
    const supabase = await createClient(clientIp(req));
    const { duplicate } = await subscribeToWaitlist(supabase, parsed.data);
    return NextResponse.json({ ok: true, duplicate });
  } catch (err) {
    // An honest 429, not the honeypot's silent success: pretending to store a signup we
    // rejected is the same lie pointing the other way, and a throttled human needs to know to
    // try again. Checked before the generic 500 so "slow down" never reads as "we're broken".
    if (isWaitlistRateLimited(err)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
