import { getWaitlistRows } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * getUser() + app_metadata role check (never getSession). This is now a PRIMARY
 * gate, not defence in depth: proxy.ts was deleted with the Cloudflare migration
 * (the adapter cannot run Node middleware), so nothing gates this route ahead of
 * the handler. The DEFINER RPC behind it still gates independently. Streams the
 * full waitlist as a CSV download.
 */
function csvCell(value: string): string {
  // Neutralize CSV/formula injection (cells starting with = + - @ tab CR), then
  // RFC 4180-quote and escape embedded quotes.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  const supabase = await createAuthedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if ((user?.app_metadata as { role?: string } | undefined)?.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const rows = await getWaitlistRows(supabase);
  const header = ['email', 'locale', 'source', 'created_at'];
  const body = rows.map((r) =>
    [r.email, r.locale, r.source ?? '', r.created_at].map((c) => csvCell(String(c))).join(','),
  );
  const csv = [header.join(','), ...body].join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="athanor-waitlist.csv"',
    },
  });
}
