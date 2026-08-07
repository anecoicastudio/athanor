import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';

// Fan-out extracted from index.ts so the sole-writer insert + best-effort push are
// unit-testable (deno test): index.ts keeps the transport shell (OPTIONS,
// requireServiceRole, body parse, fetch/URL/serviceKey wiring) and injects everything
// here (repo convention: DI over mocks).

export type FanOutCtx = {
  /** service role — the ONLY legitimate writer of notifications rows (06 §2.11) */
  admin: SupabaseClient;
  /** best-effort push-dispatch invoke; index wires fetch + SUPABASE_URL + serviceKey */
  invokePush: (payload: Record<string, unknown>) => Promise<unknown>;
};

export type FanOutBody = {
  recipient_id: string;
  type: string;
  template_key: string;
  params?: Record<string, unknown>;
  entity_ref?: Record<string, unknown>;
};

/** Pure field validation — the three required fields must be non-empty strings. */
export function validateFanOutBody(raw: unknown): FanOutBody | null {
  const body = raw as Partial<FanOutBody> | null | undefined;
  const missing = (v: unknown) => typeof v !== 'string' || v.trim() === '';
  if (missing(body?.recipient_id) || missing(body?.type) || missing(body?.template_key)) {
    return null;
  }
  return body as FanOutBody;
}

export async function processFanOut(ctx: FanOutCtx, raw: unknown): Promise<Response> {
  const body = validateFanOutBody(raw);
  if (!body) return error('missing fields', 400);

  // The ONLY legitimate writer of notifications rows (service role bypasses RLS; clients = 42501).
  const { error: insErr } = await ctx.admin.from('notifications').insert({
    recipient_id: body.recipient_id,
    type: body.type,
    template_key: body.template_key,
    params: body.params ?? {},
    entity_ref: body.entity_ref ?? null,
  });
  if (insErr) return error(`notification insert failed: ${insErr.message}`, 500);

  // Then dispatch push (best-effort — the in-app row is already written; preference gate lives
  // there). push-dispatch takes entity_ref as a STRING, so the object crosses JSON-stringified.
  try {
    await ctx.invokePush({
      recipient_id: body.recipient_id,
      type: body.type,
      template_key: body.template_key,
      params: body.params ?? {},
      entity_ref: JSON.stringify(body.entity_ref ?? {}),
    });
  } catch (e) {
    console.error('push-dispatch invoke failed', e);
  }
  return json({ ok: true });
}
