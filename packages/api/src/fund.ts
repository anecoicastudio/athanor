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
import { channelTopic } from './realtime';

export const fundKeys = {
  all: ['fund'] as const,
  activeEdition: () => [...fundKeys.all, 'edition', 'active'] as const,
  edition: (id: string) => [...fundKeys.all, 'edition', id] as const,
  aggregate: (editionId: string) => [...fundKeys.all, 'aggregate', editionId] as const,
  myContributions: (profileId: string) => [...fundKeys.all, 'contributions', profileId] as const,
};

/** The current non-closed edition (newest year). The unique index guarantees ≤1 active per year. */
export async function getActiveEdition(client: AthanorClient): Promise<FundEdition | null> {
  const { data, error } = await client
    .from('fund_editions')
    .select('*')
    .neq('phase', 'closed')
    .order('year', { ascending: false })
    .limit(1)
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
 * Start a Stripe Checkout for a Dream-Fund contribution via the create-contribution-session edge fn.
 * Returns the hosted Checkout URL (opened in expo-web-browser). Money flows server-side only (rule #6):
 * the fund total moves when the webhook (W3) lands → fund_aggregates → the realtime ticker. Never optimistic.
 */
export async function createContributionSession(
  client: AthanorClient,
  input: ContributionSessionInput,
): Promise<{ url: string }> {
  const { data, error } = await client.functions.invoke('create-contribution-session', {
    body: { editionId: input.editionId, amountCents: input.amountCents },
  });
  if (error) throw error;
  const url = (data as { url?: string } | null)?.url;
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
    q = q.or(`created_at.lt.${cursor.ts},and(created_at.eq.${cursor.ts},id.lt.${cursor.id})`);
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((r) => fundContributionSchema.parse(r));
  const last = rows.length === limit ? rows.at(-1) : undefined;
  return { rows, nextCursor: last ? { ts: last.created_at, id: last.id } : null };
}

export type { FundAggregate, FundContribution, FundEdition };
