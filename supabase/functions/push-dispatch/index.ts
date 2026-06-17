import Expo from 'npm:expo-server-sdk@^4';
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

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  if (!body?.recipient_id || !body?.template_key || !body?.type || !body?.entity_ref) {
    return error('missing fields', 400);
  }

  const admin = supabaseAdmin();

  // 1. Preference gate — TODO(M9): query notification_preferences(recipient, type, channel='push').
  //    Table is M9; pre-M9 every push sends (default-on per the master rule, 09 §2.5).

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
  const expo = new Expo({ accessToken: Deno.env.get('EXPO_ACCESS_TOKEN'), useFcmV1: true });
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
