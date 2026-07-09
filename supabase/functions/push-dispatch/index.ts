import Expo from 'npm:expo-server-sdk@^4';
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { json, error } from '../_shared/respond.ts';
import { buildPushMessages } from '../_shared/notif-templates.ts';

type Body = {
  recipient_id: string;
  type: string;
  template_key: string;
  params?: Record<string, unknown>;
  entity_ref: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Caller authorization: service-role only (see _shared/auth.ts). The enqueue_push trigger
  // sets this bearer to app.settings.push_dispatch_key, which MUST be the service-role key
  // (set at deploy time).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const missing = (v: unknown) => typeof v !== 'string' || v.trim() === '';
  if (
    missing(body?.recipient_id) ||
    missing(body?.template_key) ||
    missing(body?.type) ||
    missing(body?.entity_ref)
  ) {
    return error('missing fields', 400);
  }

  const admin = supabaseAdmin();

  // 1. Preference gate. Master push toggle first (profiles.push_enabled), then the per-type
  //    channel='push' opt-out row. Absent rows = default-on (master rule, 09 §2.5). The in-app
  //    notification row is unaffected — this only suppresses push transport.
  const [{ data: prof }, { data: pref }] = await Promise.all([
    admin.from('profiles').select('push_enabled').eq('id', body.recipient_id).maybeSingle(),
    admin
      .from('notification_preferences')
      .select('enabled')
      .eq('profile_id', body.recipient_id)
      .eq('type', body.type)
      .eq('channel', 'push')
      .maybeSingle(),
  ]);
  if (prof?.push_enabled === false) return json({ sent: 0, skipped: 'master_push_off' });
  if (pref?.enabled === false) return json({ sent: 0, skipped: 'type_pref_off' });

  // 2. Token lookup + recipient locale (multi-device).
  const [{ data: tokens }, { data: profile }] = await Promise.all([
    admin.from('push_tokens').select('token').eq('profile_id', body.recipient_id),
    admin.from('profiles').select('locale').eq('id', body.recipient_id).maybeSingle(),
  ]);
  const tokenList = (tokens ?? []).map((r) => r.token);
  if (tokenList.length === 0) return json({ sent: 0 });

  const locale = profile?.locale === 'en' ? 'en' : 'it';

  // 3+4. Localize, validate, build.
  const messages = buildPushMessages(
    tokenList,
    {
      type: body.type,
      templateKey: body.template_key,
      params: body.params ?? {},
      entityRef: body.entity_ref,
      locale,
    },
    (t) => Expo.isExpoPushToken(t),
  );
  if (messages.length === 0) return json({ sent: 0 });

  // 5. Chunk + send.
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!expoToken) return error('EXPO_ACCESS_TOKEN not set', 500);
  const expo = new Expo({ accessToken: expoToken, useFcmV1: true });
  const chunks = expo.chunkPushNotifications(messages);
  let sent = 0;
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      sent += tickets.length;
      // 6. Receipt sweep (DeviceNotRegistered → prune token) is a deferred scheduled job — TODO(M5-deploy).
    } catch (e) {
      console.error('push send failed', e);
    }
  }
  return json({ sent });
});
