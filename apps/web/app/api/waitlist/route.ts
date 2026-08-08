import { NextResponse } from 'next/server';
import { subscribeToWaitlist } from '@athanor/api';
import { waitlistInsertSchema } from '@athanor/schemas';
import { createClient } from '@/utils/supabase/server';

/**
 * Pre-launch waitlist capture. Validates at the boundary (Zod), stores the email
 * in `email_waitlist` via the anon client (RLS allows anon insert-only), then
 * notifies athanor@gmail.com via Resend. The notify is best-effort and skipped
 * entirely when RESEND_API_KEY is unset — capture still succeeds without it.
 */
async function notify(email: string, locale: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const to = process.env.WAITLIST_TO ?? 'athanor@gmail.com';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Athanor <onboarding@resend.dev>',
      to,
      subject: `✦ Nuova stella in waitlist — ${email}`,
      text: `Email: ${email}\nLingua: ${locale}\nQuando: ${new Date().toISOString()}`,
    }),
  });
}

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
    const supabase = await createClient();
    const { duplicate } = await subscribeToWaitlist(supabase, parsed.data);
    if (!duplicate) {
      await notify(parsed.data.email, parsed.data.locale).catch(() => {});
    }
    return NextResponse.json({ ok: true, duplicate });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
