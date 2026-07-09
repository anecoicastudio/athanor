// notification-fan-out (M9) — the SINGLE writer of public.notifications rows (clients are RLS-denied
// INSERT, 06 §2.11). Maps a domain event → one notification row → invokes push-dispatch (transport +
// preference gate live there, single responsibility).
//
// TODO(M9-fanout-deploy): deploy (`supabase functions deploy notification-fan-out`) + set secrets.
// DB-trigger / direct-invocation wiring from source tables (M2 milestone_helps, M3 post_reactions/
// projects, M4 events/event_tickets, M5 momento_proposals/connection_requests, M7 fund_aggregates)
// is DEFERRED — until producers call this, the in-app center renders the honest empty state.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { json, error } from '../_shared/respond.ts';

type Body = {
  recipient_id: string;
  type: string;
  template_key: string;
  params?: Record<string, unknown>;
  entity_ref?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Caller authorization: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;
  const { serviceKey } = gate;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const missing = (v: unknown) => typeof v !== 'string' || v.trim() === '';
  if (missing(body?.recipient_id) || missing(body?.type) || missing(body?.template_key)) {
    return error('missing fields', 400);
  }

  const admin = supabaseAdmin();

  // The ONLY legitimate writer of notifications rows (service role bypasses RLS; clients = 42501).
  const { error: insErr } = await admin.from('notifications').insert({
    recipient_id: body.recipient_id,
    type: body.type,
    template_key: body.template_key,
    params: body.params ?? {},
    entity_ref: body.entity_ref ?? null,
  });
  if (insErr) return error(`notification insert failed: ${insErr.message}`, 500);

  // Then dispatch push (best-effort — the in-app row is already written; preference gate lives there).
  const url = Deno.env.get('SUPABASE_URL');
  try {
    await fetch(`${url}/functions/v1/push-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        recipient_id: body.recipient_id,
        type: body.type,
        template_key: body.template_key,
        params: body.params ?? {},
        entity_ref: JSON.stringify(body.entity_ref ?? {}),
      }),
    });
  } catch (e) {
    console.error('push-dispatch invoke failed', e);
  }
  return json({ ok: true });
});
