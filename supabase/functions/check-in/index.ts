import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { processCheckIn } from './logic.ts';

const qrSecret = Deno.env.get('QR_SIGNING_SECRET')!;

/**
 * POST { eventId, qrToken } → { result: 'valid'|'already'|'invalid'|'wrongEvent', name? }.
 * Organizer-only (verify_jwt=true). Transport shell only — the verdict ladder lives in
 * ./logic.ts (unit-tested); this file wires auth, body parse, and the two clients.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  // Identify the scanner from their JWT.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  let eventId: string;
  let qrToken: string;
  try {
    ({ eventId, qrToken } = await req.json());
  } catch {
    return error('invalid body', 400);
  }
  if (!eventId || !qrToken) return error('eventId and qrToken required', 400);

  return processCheckIn(
    { admin: supabaseAdmin(), userClient: auth.userClient, qrSecret },
    { scannerId: auth.user.id, eventId, qrToken },
  );
});
