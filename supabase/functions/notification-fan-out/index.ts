// notification-fan-out (M9) — the SINGLE writer of public.notifications rows (clients are RLS-denied
// INSERT, 06 §2.11). Maps a domain event → one notification row → invokes push-dispatch (transport +
// preference gate live there, single responsibility). Transport shell only — the insert + best-effort
// push live in ./logic.ts (unit-tested); this file wires auth, body parse, and the invoke closure.
//
// TODO(M9-fanout-deploy): deploy (`supabase functions deploy notification-fan-out`) + set secrets.
// DB-trigger / direct-invocation wiring from source tables (M2 milestone_helps, M3 post_reactions/
// projects, M4 events/event_tickets, M5 momento_proposals/connection_requests, M7 fund_aggregates)
// is DEFERRED — until producers call this, the in-app center renders the honest empty state.
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
      invokePush: (payload) =>
        fetch(`${url}/functions/v1/push-dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: secretKey },
          body: JSON.stringify(payload),
        }),
    },
    body,
  );
});
