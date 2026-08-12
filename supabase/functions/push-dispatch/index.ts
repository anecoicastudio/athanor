import { Expo } from 'expo-server-sdk';
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import type { ExpoMessage } from '../_shared/notif-templates.ts';
import { processPushDispatch } from './logic.ts';

/**
 * Transport shell only — the preference gate + build/send pipeline live in ./logic.ts
 * (unit-tested); this file wires auth, body parse, env, and the Expo SDK closures.
 *
 * Two modes on one function (#128): the default send, and `{ mode: 'sweep' }` from the hourly
 * invoke_push_receipt_sweep() cron, which reads Expo receipts and prunes dead tokens. Same
 * access token, same service-role posture — hence no second function and no new config.toml row.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Caller authorization: service-role only (see _shared/auth.ts). The enqueue_push trigger
  // sets this bearer to app.settings.push_dispatch_key, which MUST be the service-role key
  // (set at deploy time).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }

  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!expoToken) return error('EXPO_ACCESS_TOKEN not set', 500);
  const expo = new Expo({ accessToken: expoToken, useFcmV1: true });

  return processPushDispatch(
    {
      admin: supabaseAdmin(),
      isExpoPushToken: (t) => Expo.isExpoPushToken(t),
      chunk: (msgs) => expo.chunkPushNotifications(msgs) as ExpoMessage[][],
      send: (chunk) => expo.sendPushNotificationsAsync(chunk),
      chunkReceiptIds: (ids) => expo.chunkPushNotificationReceiptIds(ids),
      getReceipts: (ids) => expo.getPushNotificationReceiptsAsync(ids),
      now: () => new Date(),
    },
    body,
  );
});
