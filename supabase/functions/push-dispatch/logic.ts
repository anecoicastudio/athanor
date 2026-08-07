import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { buildPushMessages, type ExpoMessage } from '../_shared/notif-templates.ts';

// Push pipeline extracted from index.ts so the preference gate is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS, requireServiceRole, body parse, env reads,
// Expo client construction) and injects everything here (repo convention: DI over mocks).
// This file must NEVER import expo-server-sdk — the SDK bits arrive as ctx closures.

export type PushDispatchCtx = {
  /** service role — cross-user reads of prefs/tokens/locale */
  admin: SupabaseClient;
  /** Expo.isExpoPushToken (static, pure) */
  isExpoPushToken: (t: string) => boolean;
  /** expo.chunkPushNotifications — regroups messages under the Expo batch cap */
  chunk: (messages: ExpoMessage[]) => ExpoMessage[][];
  /** expo.sendPushNotificationsAsync — resolves the tickets for one chunk */
  send: (chunk: ExpoMessage[]) => Promise<unknown[]>;
};

export type PushDispatchBody = {
  recipient_id: string;
  type: string;
  template_key: string;
  params?: Record<string, unknown>;
  entity_ref: string;
};

/** Pure field validation — the four required fields must be non-empty strings. */
export function validatePushBody(raw: unknown): PushDispatchBody | null {
  const body = raw as Partial<PushDispatchBody> | null | undefined;
  const missing = (v: unknown) => typeof v !== 'string' || v.trim() === '';
  if (
    missing(body?.recipient_id) ||
    missing(body?.template_key) ||
    missing(body?.type) ||
    missing(body?.entity_ref)
  ) {
    return null;
  }
  return body as PushDispatchBody;
}

export async function processPushDispatch(ctx: PushDispatchCtx, raw: unknown): Promise<Response> {
  const body = validatePushBody(raw);
  if (!body) return error('missing fields', 400);

  const { admin } = ctx;

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
  const tokenList = ((tokens ?? []) as { token: string }[]).map((r) => r.token);
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
    ctx.isExpoPushToken,
  );
  if (messages.length === 0) return json({ sent: 0 });

  // 5. Chunk + send. A failed chunk is swallowed (logged) so the others still go out.
  const chunks = ctx.chunk(messages);
  let sent = 0;
  for (const chunk of chunks) {
    try {
      const tickets = await ctx.send(chunk);
      sent += tickets.length;
      // 6. Receipt sweep (DeviceNotRegistered → prune token) is a deferred scheduled job — TODO(M5-deploy).
    } catch (e) {
      console.error('push send failed', e);
    }
  }
  return json({ sent });
}
