import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { buildPushMessages, type ExpoMessage } from '../_shared/notif-templates.ts';

// Push pipeline extracted from index.ts so the preference gate is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS, requireServiceRole, body parse, env reads,
// Expo client construction) and injects everything here (repo convention: DI over mocks).
// This file must NEVER import expo-server-sdk — the SDK bits arrive as ctx closures.

/** Structural mirrors of expo-server-sdk's ticket/receipt types (the SDK is not imported here). */
type ExpoErrorDetails = { error?: string; expoPushToken?: string };
export type ExpoTicket =
  | { status: 'ok'; id?: string }
  | { status: 'error'; message?: string; details?: ExpoErrorDetails };
export type ExpoReceipt =
  | { status: 'ok' }
  | { status: 'error'; message?: string; details?: ExpoErrorDetails };

export type PushDispatchCtx = {
  /** service role — cross-user reads of prefs/tokens/locale, and the token prune */
  admin: SupabaseClient;
  /** Expo.isExpoPushToken (static, pure) */
  isExpoPushToken: (t: string) => boolean;
  /** expo.chunkPushNotifications — regroups messages under the Expo batch cap */
  chunk: (messages: ExpoMessage[]) => ExpoMessage[][];
  /** expo.sendPushNotificationsAsync — resolves the tickets for one chunk */
  send: (chunk: ExpoMessage[]) => Promise<unknown[]>;
  /** expo.chunkPushNotificationReceiptIds — regroups ids under the Expo receipt-batch cap */
  chunkReceiptIds: (ids: string[]) => string[][];
  /** expo.getPushNotificationReceiptsAsync — id → receipt, ids without one yet are ABSENT */
  getReceipts: (ids: string[]) => Promise<Record<string, unknown>>;
  /** injected clock — index.ts wires () => new Date(); tests pin a fixed instant */
  now: () => Date;
};

export type PushDispatchBody = {
  recipient_id: string;
  type: string;
  template_key: string;
  params?: Record<string, unknown>;
  entity_ref: string;
};

/**
 * A receipt is not readable the instant the ticket comes back — Expo has to attempt delivery
 * first. Sweeping a ticket younger than this just burns a request for an absent id.
 */
export const RECEIPT_READY_AFTER_MS = 15 * 60 * 1000;
/**
 * Expo keeps a receipt for roughly a day. Past this a row is unanswerable, so it is dropped
 * rather than retried forever — otherwise the table only grows.
 */
export const RECEIPT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Rows drained per sweep. The cron runs hourly, so this is the per-hour ceiling. */
export const SWEEP_BATCH = 1000;

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

/**
 * Delete every dead token in one statement. Filtered by token, not by (profile, token): a token
 * identifies a device install, so if the same string is registered under two profiles both rows
 * are equally dead. Returns how many went, for the alarmable count.
 */
async function pruneTokens(admin: SupabaseClient, tokens: Set<string>): Promise<number> {
  if (tokens.size === 0) return 0;
  const list = [...tokens];
  const { error: err } = await admin.from('push_tokens').delete().in('token', list);
  if (err) {
    console.error(
      JSON.stringify({ evt: 'push_prune_failed', tokens: list.length, err: err.message }),
    );
    return 0;
  }
  return list.length;
}

/**
 * One structured line per dispatch/sweep that saw a failure. There is no metrics sink in this
 * project yet and nothing reads the response body (notification-fan-out invokes best-effort and
 * drops it), so the log IS the alarmable surface — hence JSON on one line, with a stable `evt`.
 */
function report(evt: string, counts: Record<string, number | string>): void {
  const bad = Number(counts.failed ?? 0) > 0;
  const line = JSON.stringify({ evt, ...counts });
  if (bad) console.error(line);
  else console.log(line);
}

export async function processPushDispatch(ctx: PushDispatchCtx, raw: unknown): Promise<Response> {
  // The sweep arrives from pg_cron as { mode: 'sweep' } and carries none of the send fields.
  // An absent mode means 'send' — enqueue_push has always posted a bare dispatch body.
  const mode = (raw as { mode?: unknown } | null | undefined)?.mode;
  if (mode === 'sweep') return processReceiptSweep(ctx);
  if (mode !== undefined && mode !== 'send') return error('unknown mode', 400);

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
  if (tokenList.length === 0) return json({ sent: 0, failed: 0, pruned: 0 });

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
  if (messages.length === 0) return json({ sent: 0, failed: 0, pruned: 0 });

  // 5. Chunk + send. A failed chunk is swallowed (logged + counted) so the others still go out.
  //    Tickets come back positionally — the nth ticket belongs to the nth message of the chunk —
  //    which is how a per-token verdict maps back to a token.
  const chunks = ctx.chunk(messages);
  let sent = 0;
  let failed = 0;
  const dead = new Set<string>();
  const pending: { receipt_id: string; token: string; profile_id: string }[] = [];

  for (const chunk of chunks) {
    let tickets: ExpoTicket[];
    try {
      tickets = (await ctx.send(chunk)) as ExpoTicket[];
    } catch (e) {
      // Whole chunk never left: every message in it failed, not zero of them.
      failed += chunk.length;
      console.error('push send failed', e);
      continue;
    }
    chunk.forEach((message, i) => {
      const ticket = tickets?.[i];
      if (ticket?.status === 'ok') {
        sent++;
        // 6. Remember the ticket so the hourly sweep can read its receipt (#128). Delivery-time
        //    failures — the ones that unregister a device — only surface there.
        if (ticket.id) {
          pending.push({ receipt_id: ticket.id, token: message.to, profile_id: body.recipient_id });
        }
        return;
      }
      // status 'error' (or a ticket we cannot read): NOT a send. Counting it as one is what made
      // the old `sent += tickets.length` overstate delivery.
      failed++;
      if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        // Expo can say this immediately, with no receipt round-trip — prune here as well.
        dead.add(ticket.details.expoPushToken ?? message.to);
      }
    });
  }

  if (pending.length > 0) {
    const { error: err } = await ctx.admin
      .from('push_receipts')
      .upsert(pending, { onConflict: 'receipt_id', ignoreDuplicates: true });
    if (err) console.error(JSON.stringify({ evt: 'push_receipt_store_failed', err: err.message }));
  }
  const pruned = await pruneTokens(ctx.admin, dead);

  report('push_dispatch', { sent, failed, pruned, recipient_id: body.recipient_id });
  return json({ sent, failed, pruned });
}

/**
 * Second pass (#128). Reads Expo's receipts for tickets sent long enough ago to have one, prunes
 * the tokens whose receipt says DeviceNotRegistered, and drops the rows it resolved.
 *
 * Ids Expo has no receipt for yet are simply absent from the response — those rows are left
 * alone and retried on the next run, until RECEIPT_TTL_MS gives up on them.
 */
async function processReceiptSweep(ctx: PushDispatchCtx): Promise<Response> {
  const { admin } = ctx;
  const now = ctx.now().getTime();
  const readyBefore = new Date(now - RECEIPT_READY_AFTER_MS).toISOString();
  const expiredBefore = new Date(now - RECEIPT_TTL_MS).toISOString();

  // Rows Expo will no longer answer for. Dropped first so they never occupy the batch.
  const { error: expireErr } = await admin
    .from('push_receipts')
    .delete()
    .lt('created_at', expiredBefore);
  if (expireErr) {
    console.error(JSON.stringify({ evt: 'push_receipt_expire_failed', err: expireErr.message }));
  }

  const { data: rows, error: readErr } = await admin
    .from('push_receipts')
    .select('receipt_id, token')
    .lt('created_at', readyBefore)
    .order('created_at', { ascending: true })
    .limit(SWEEP_BATCH);
  if (readErr) return error('receipt read failed', 500);

  const tokenOf = new Map(
    ((rows ?? []) as { receipt_id: string; token: string }[]).map((r) => [r.receipt_id, r.token]),
  );
  if (tokenOf.size === 0) return json({ checked: 0, failed: 0, pruned: 0 });

  const dead = new Set<string>();
  const resolved: string[] = [];
  let checked = 0;
  let failed = 0;

  for (const ids of ctx.chunkReceiptIds([...tokenOf.keys()])) {
    let receipts: Record<string, unknown>;
    try {
      receipts = await ctx.getReceipts(ids);
    } catch (e) {
      // Leave this chunk's rows in place — the next run retries them.
      console.error('push receipt fetch failed', e);
      continue;
    }
    for (const [id, raw] of Object.entries(receipts ?? {})) {
      const receipt = raw as ExpoReceipt | null;
      resolved.push(id);
      checked++;
      if (receipt?.status !== 'error') continue;
      failed++;
      if (receipt.details?.error === 'DeviceNotRegistered') {
        dead.add(receipt.details.expoPushToken ?? tokenOf.get(id) ?? '');
      }
    }
  }
  dead.delete('');

  const pruned = await pruneTokens(admin, dead);
  if (resolved.length > 0) {
    const { error: delErr } = await admin.from('push_receipts').delete().in('receipt_id', resolved);
    if (delErr) {
      console.error(JSON.stringify({ evt: 'push_receipt_drain_failed', err: delErr.message }));
    }
  }

  report('push_receipt_sweep', { checked, failed, pruned });
  return json({ checked, failed, pruned });
}
