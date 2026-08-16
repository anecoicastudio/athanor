import {
  type FundAggregate,
  fundAggregateSchema,
  type FundContribution,
  fundContributionSchema,
  type FundEdition,
  fundEditionSchema,
  type ContributionSessionInput,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';
import { channelTopic } from './realtime';

export const fundKeys = {
  all: ['fund'] as const,
  activeEdition: () => [...fundKeys.all, 'edition', 'active'] as const,
  edition: (id: string) => [...fundKeys.all, 'edition', id] as const,
  aggregate: (editionId: string) => [...fundKeys.all, 'aggregate', editionId] as const,
  myContributions: (profileId: string) => [...fundKeys.all, 'contributions', profileId] as const,
};

/** The current non-closed cycle. `fund_editions_one_active` guarantees at most one (#215). */
export async function getActiveEdition(client: AthanorClient): Promise<FundEdition | null> {
  const { data, error } = await client
    .from('fund_editions')
    .select('*')
    .neq('phase', 'closed')
    .maybeSingle();
  if (error) throw error;
  return data ? fundEditionSchema.parse(data) : null;
}

/** The live-ticker aggregate for an edition; null until the first contribution lands. */
export async function getFundAggregate(
  client: AthanorClient,
  editionId: string,
): Promise<FundAggregate | null> {
  const { data, error } = await client
    .from('fund_aggregates')
    .select('*')
    .eq('edition_id', editionId)
    .maybeSingle();
  if (error) throw error;
  return data ? fundAggregateSchema.parse(data) : null;
}

/** Realtime fund-ticker subscription. Returns a cleanup fn (api.md invariant #1). */
export function subscribeFundAggregate(
  client: AthanorClient,
  editionId: string,
  onAggregate: (agg: FundAggregate) => void,
  onStatus?: (status: string) => void,
): () => void {
  const channel = client
    .channel(channelTopic(`fund:${editionId}:aggregate`))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'fund_aggregates',
        filter: `edition_id=eq.${editionId}`,
      },
      (payload) => {
        const parsed = fundAggregateSchema.safeParse(payload.new);
        if (parsed.success) onAggregate(parsed.data);
      },
    )
    .subscribe((status) => onStatus?.(status));
  return () => {
    void client.removeChannel(channel);
  };
}

/**
 * A refusal from create-contribution-session. `code` is the server's `{error}` string —
 * those strings are the stable contract (#103 idiom); the screen maps them to copy so a
 * D34 window refusal never reads as a payment failure (#222). Plumbing only: no message
 * mapping here (rule api.md).
 */
export class ContributionSessionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`create-contribution-session refused: ${code} (${status})`);
    this.name = 'ContributionSessionError';
  }
}

/**
 * Start a Stripe Checkout for a Dream-Fund contribution via the create-contribution-session edge fn.
 * Returns the hosted Checkout URL (opened in expo-web-browser). Money flows server-side only (rule #6):
 * the fund total moves when the webhook (W3) lands → fund_aggregates → the realtime ticker. Never optimistic.
 *
 * `amountCents` is the GIFT. `coverFees` (#236) asks the server to add Stripe's processing on
 * top so the gift arrives whole — a flag, never a figure: the gross-up is recomputed
 * server-side, and whatever the disclosure screen showed the payer is display only.
 */
export async function createContributionSession(
  client: AthanorClient,
  input: ContributionSessionInput,
): Promise<{ url: string }> {
  const res = await client.functions.invoke<unknown>('create-contribution-session', {
    body: {
      editionId: input.editionId,
      amountCents: input.amountCents,
      coverFees: input.coverFees === true,
    },
  });
  if (res.error) {
    // On a non-2xx, FunctionsHttpError hangs the Response off `.context` — the JSON body is
    // the only place the server's reason survives. Read it before rethrowing; an unreadable
    // body (relay/network failure, non-JSON) falls back to the raw error unchanged.
    const ctx = (res.error as { context?: { status?: number; json?: () => Promise<unknown> } })
      .context;
    if (ctx && typeof ctx.json === 'function' && typeof ctx.status === 'number') {
      let code: unknown;
      try {
        code = ((await ctx.json()) as { error?: unknown } | null)?.error;
      } catch {
        // body unreadable — rethrow the raw error below
      }
      if (typeof code === 'string') throw new ContributionSessionError(code, ctx.status);
    }
    // supabase-js types FunctionsResponse.error as `any`; every concrete case
    // (FunctionsHttpError/RelayError/FetchError) extends FunctionsError extends Error.
    throw res.error as Error;
  }
  const url = (res.data as { url?: string } | null)?.url;
  if (!url) throw new Error('contribution checkout did not return a url');
  return { url };
}

/** Opaque keyset cursor — the last (created_at, id) seen. Never an offset (rule #9). */
export type ContributionCursor = { ts: string; id: string };

/**
 * Owner's contribution receipts, newest-first, keyset on (created_at, id) — matches
 * the fund_contributions_profile_feed index. RLS (select-own) scopes rows to the caller;
 * rows are written only by the Stripe webhook (rule #6) — this is a read-only history.
 */
export async function getMyContributions(
  client: AthanorClient,
  profileId: string,
  { cursor, limit = 20 }: { cursor?: ContributionCursor; limit?: number } = {},
): Promise<{ rows: FundContribution[]; nextCursor: ContributionCursor | null }> {
  let q = client
    .from('fund_contributions')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (cursor) {
    q = q.or(keysetFilter('created_at', 'id', cursor.ts, cursor.id, 'lt'));
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((r) => fundContributionSchema.parse(r));
  return {
    rows,
    nextCursor: nextCursorOf(rows, limit, (last) => ({ ts: last.created_at, id: last.id })),
  };
}

export type { FundAggregate, FundContribution, FundEdition };
