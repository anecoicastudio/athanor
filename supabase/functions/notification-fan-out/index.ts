// notification-fan-out (M9) — the SINGLE writer of public.notifications rows (clients are RLS-denied
// INSERT, 06 §2.11). Maps a domain event → one notification row → invokes push-dispatch (transport +
// preference gate live there, single responsibility). Transport shell only — the insert + best-effort
// push live in ./logic.ts (unit-tested); this file wires auth, body parse, and the invoke closure.
// Producers: DB triggers call athanor.enqueue_notification (20260701160235_m9_notification_producers.sql
// and later producer migrations), which POSTs here via pg_net.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { processFanOut } from './logic.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Caller authorization: service-role only (see _shared/auth.ts). verify_jwt is false for
  // this function, so this gate is the only one — it must stay ahead of the body parse.
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;
  const { secretKey } = gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  return processFanOut(
    {
      admin: supabaseAdmin(),
      // Presents THIS function's own key on `apikey`, not the caller's replayed credential
      // (a confused deputy, and it would break the moment the caller rotates). New-style
      // secret keys must not ride Authorization — the platform tries to parse it as a JWT.
      // Rejects on a non-2xx, and always drains the body. A bare `fetch` RESOLVES for a 500,
      // so the caller's catch never fired and a push-dispatch outage was recorded as full
      // delivery; in audience mode (#127) that is one invoke per member, so an undrained body
      // per member would also accumulate inside a single isolate.
      invokePush: async (payload) => {
        const res = await fetch(`${url}/functions/v1/push-dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: secretKey },
          body: JSON.stringify(payload),
        });
        await res.body?.cancel();
        if (!res.ok) throw new Error(`push-dispatch responded ${res.status}`);
      },
    },
    body,
  );
});
