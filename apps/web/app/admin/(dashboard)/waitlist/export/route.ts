import { getWaitlistPage, type WaitlistAdminRow } from '@athanor/api';
import { createAuthedClient } from '@/utils/supabase/server';
import { isAdmin } from '@/lib/is-admin';

export const dynamic = 'force-dynamic';

/**
 * getUser() + isAdmin() — never getSession(), and never the role predicate spelled out
 * inline (#62: one implementation, the tested one). This is a PRIMARY gate, not defence
 * in depth: proxy.ts was deleted with the Cloudflare migration (the adapter cannot run
 * Node middleware), so nothing gates this route ahead of the handler. The DEFINER RPC
 * behind it still gates independently.
 *
 * Streams the waitlist as a CSV download, one keyset page per RPC round-trip (#335). The
 * previous shape read every row into memory and joined one string — fine at launch size,
 * and a Worker with a 10 ms CPU budget and a 128 MB heap as the list fills. Streaming
 * bounds the memory to one page and gets bytes moving immediately; the CPU still scales
 * with the rows, which is the limit that remains.
 */

/** Rows per RPC round-trip. Under the reader's ceiling (it asks for one more as a probe). */
const EXPORT_PAGE = 500;
const HEADER = 'email,locale,source,created_at';

function csvCell(value: string): string {
  // Neutralize CSV/formula injection (cells starting with = + - @ tab CR), then
  // RFC 4180-quote and escape embedded quotes.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvLine(r: WaitlistAdminRow): string {
  return [r.email, r.locale, r.source ?? '', r.created_at].map((c) => csvCell(String(c))).join(',');
}

type Page = Awaited<ReturnType<typeof getWaitlistPage>>;

export async function GET() {
  const supabase = await createAuthedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Fails closed on an errored getUser() too: no user, no admin.
  if (!isAdmin(user)) return new Response('Forbidden', { status: 403 });

  // The first page is read BEFORE the Response exists: an RPC refusal (42501) or a database
  // fault here surfaces as an HTTP error the browser shows. Once streaming has begun the 200
  // is already on the wire, and the only signal left for a failure is a file that stops short.
  let pending: Page | null = await getWaitlistPage(supabase, { limit: EXPORT_PAGE });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(HEADER));
    },
    async pull(controller) {
      if (pending === null) {
        controller.close();
        return;
      }
      // A row the reader withheld is logged by the reader and counted on the panel; the
      // file cannot carry it (a comment line breaks every CSV parser).
      const { rows, nextCursor } = pending;
      if (rows.length > 0) {
        controller.enqueue(encoder.encode(rows.map((r) => `\r\n${csvLine(r)}`).join('')));
      }
      // The next page is fetched only once this one is on its way — back-pressure, not a
      // buffer. A failure here errors the stream: the download stops short and says so,
      // which beats a clean-looking file that is missing its tail.
      try {
        pending = nextCursor
          ? await getWaitlistPage(supabase, { cursor: nextCursor, limit: EXPORT_PAGE })
          : null;
      } catch (e) {
        console.error('[waitlist export] page read failed mid-stream:', e);
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="athanor-waitlist.csv"',
    },
  });
}
