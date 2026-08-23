import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';

// Fan-out extracted from index.ts so the sole-writer insert + best-effort push are
// unit-testable (deno test): index.ts keeps the transport shell (OPTIONS,
// requireServiceRole, body parse, fetch/URL/serviceKey wiring) and injects everything
// here (repo convention: DI over mocks).
//
// TWO shapes, distinguished by the presence of `audience` (#127):
//
//   single    { recipient_id, type, template_key, … }  → one row, one push. Unchanged.
//   audience  { audience, type, template_key, dedupe_key, … } → one row per eligible member,
//             written in bulk, then a bounded push loop.
//
// The audience shape exists because a fund milestone or a countdown has no single recipient,
// which is why 20260701160235 skipped fund_aggregates and why #241 removed the type outright.
// Shape A (N rows) was chosen over a broadcast row clients resolve: per-recipient read_at is
// what makes the notification centre's unread state work, and a shared row has nowhere to put it.
//
// `audience` is a NAMED selector, never a predicate from the caller. SQL passes 'all_members';
// what that means is decided HERE, once. A predicate crossing the wire would be an injection
// surface and would put eligibility in two places.

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

export type FanOutAudienceBody = {
  audience: string;
  type: string;
  template_key: string;
  /** mandatory here: it is what makes a re-send after a 5xx safe (#521) */
  dedupe_key: string;
  params?: Record<string, unknown>;
  entity_ref?: Record<string, unknown>;
};

/** The only audience that exists. A name the DB does not know is rejected, not guessed at. */
export const AUDIENCES = ['all_members'] as const;

/**
 * Recipients resolved per page. The bulk insert is one statement per page, so this bounds both
 * the PostgREST response and the insert payload rather than the audience.
 */
export const AUDIENCE_PAGE = 1000;

/**
 * push-dispatch invokes in flight. It is one HTTP call per recipient — it reads that person's
 * prefs, tokens and locale, so it cannot be batched without changing its contract — and an
 * unbounded Promise.all over the whole membership would open one socket per member.
 */
export const PUSH_CONCURRENCY = 8;

/** Pure field validation — the three required fields must be non-empty strings. */
export function validateFanOutBody(raw: unknown): FanOutBody | null {
  const body = raw as Partial<FanOutBody> | null | undefined;
  const missing = (v: unknown) => typeof v !== 'string' || v.trim() === '';
  if (missing(body?.recipient_id) || missing(body?.type) || missing(body?.template_key)) {
    return null;
  }
  return body as FanOutBody;
}

/** Pure field validation for the audience shape — four required non-empty strings. */
export function validateAudienceBody(raw: unknown): FanOutAudienceBody | null {
  const body = raw as Partial<FanOutAudienceBody> | null | undefined;
  const missing = (v: unknown) => typeof v !== 'string' || v.trim() === '';
  if (
    missing(body?.audience) ||
    missing(body?.type) ||
    missing(body?.template_key) ||
    missing(body?.dedupe_key)
  ) {
    return null;
  }
  return body as FanOutAudienceBody;
}

/**
 * Eligible recipients for a broadcast, one page at a time.
 *
 * The predicate mirrors athanor.is_active() (20260813045347) rather than inventing a second
 * definition of "active": not banned, not currently suspended. There is no deleted_at to check —
 * erasure DELETEs the profile row through the GDPR queue, so a departed member is simply absent.
 */
async function eligibleRecipients(
  ctx: FanOutCtx,
  after: string | null,
): Promise<{ ids: string[]; error?: string }> {
  let q = ctx.admin
    .from('profiles')
    .select('id')
    .is('banned_at', null)
    .or(`suspended_until.is.null,suspended_until.lte.${new Date().toISOString()}`)
    .order('id', { ascending: true })
    .limit(AUDIENCE_PAGE);
  // Keyset, never offset (rule 9): the audience is read in pages while nothing stops a new
  // member signing up mid-broadcast, and an offset would skip a row under concurrent inserts.
  if (after) q = q.gt('id', after);
  const { data, error: err } = await q;
  if (err) return { ids: [], error: (err as { message?: string }).message ?? 'unknown' };
  return { ids: ((data ?? []) as { id: string }[]).map((r) => r.id) };
}

/** Invoke push-dispatch for many recipients with a bounded number in flight. */
async function pushMany(
  ctx: FanOutCtx,
  recipients: string[],
  payload: Record<string, unknown>,
): Promise<void> {
  for (let i = 0; i < recipients.length; i += PUSH_CONCURRENCY) {
    const slice = recipients.slice(i, i + PUSH_CONCURRENCY);
    await Promise.all(
      slice.map((recipient_id) =>
        // Best-effort per recipient, exactly as the single path is: the in-app row is already
        // written, and one member's dead token must not cost the rest their push.
        Promise.resolve(ctx.invokePush({ ...payload, recipient_id })).catch((e) => {
          console.error('push-dispatch invoke failed', e);
        }),
      ),
    );
  }
}

/**
 * Broadcast: one row per eligible member, then a push to the ones whose row is NEW.
 *
 * `ignoreDuplicates` makes the insert `on conflict do nothing` against the partial unique index
 * on (recipient_id, dedupe_key), and the `select()` after it returns only the rows that were
 * actually inserted. That is what makes a re-send after a 5xx safe end to end: the second run
 * writes nothing and — because it pushes what it inserted, not what it intended to insert —
 * pushes nobody. Without that the retry #521 asks for would double every push.
 */
async function processAudienceFanOut(ctx: FanOutCtx, body: FanOutAudienceBody): Promise<Response> {
  if (!(AUDIENCES as readonly string[]).includes(body.audience)) {
    return error(`unknown audience: ${body.audience}`, 400);
  }

  let after: string | null = null;
  let recipients = 0;
  let inserted = 0;

  for (;;) {
    const page = await eligibleRecipients(ctx, after);
    if (page.error) return error(`audience read failed: ${page.error}`, 500);
    if (page.ids.length === 0) break;
    recipients += page.ids.length;
    after = page.ids[page.ids.length - 1];

    const { data, error: insErr } = await ctx.admin
      .from('notifications')
      .upsert(
        page.ids.map((recipient_id) => ({
          recipient_id,
          type: body.type,
          template_key: body.template_key,
          params: body.params ?? {},
          entity_ref: body.entity_ref ?? null,
          dedupe_key: body.dedupe_key,
        })),
        { onConflict: 'recipient_id,dedupe_key', ignoreDuplicates: true },
      )
      .select('recipient_id');
    if (insErr) {
      return error(`notification insert failed: ${(insErr as { message?: string }).message}`, 500);
    }

    const fresh = ((data ?? []) as { recipient_id: string }[]).map((r) => r.recipient_id);
    inserted += fresh.length;
    await pushMany(ctx, fresh, {
      type: body.type,
      template_key: body.template_key,
      params: body.params ?? {},
      entity_ref: JSON.stringify(body.entity_ref ?? {}),
    });

    if (page.ids.length < AUDIENCE_PAGE) break;
  }

  // Structured, because nothing reads this response body: enqueue_audience_notification POSTs
  // through pg_net and drops it. `inserted < recipients` is the visible signal that a re-send
  // deduped rather than delivered, which is the thing an operator would want to see.
  console.log(
    JSON.stringify({ evt: 'fanout_audience', audience: body.audience, recipients, inserted }),
  );
  return json({ ok: true, recipients, inserted });
}

export async function processFanOut(ctx: FanOutCtx, raw: unknown): Promise<Response> {
  // The audience shape is distinguished by its selector, not by a mode field: a body carrying
  // `audience` cannot be a single-recipient body, and one carrying `recipient_id` cannot be a
  // broadcast. Producers already POST bare bodies (no mode), so adding one would have meant
  // changing every existing caller.
  if ((raw as { audience?: unknown } | null | undefined)?.audience !== undefined) {
    const audienceBody = validateAudienceBody(raw);
    if (!audienceBody) return error('missing fields', 400);
    return processAudienceFanOut(ctx, audienceBody);
  }

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
