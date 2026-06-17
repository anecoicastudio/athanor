import {
  type FundAggregate,
  fundAggregateSchema,
  type FundEdition,
  fundEditionSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const fundKeys = {
  all: ['fund'] as const,
  activeEdition: () => [...fundKeys.all, 'edition', 'active'] as const,
  edition: (id: string) => [...fundKeys.all, 'edition', id] as const,
  aggregate: (editionId: string) => [...fundKeys.all, 'aggregate', editionId] as const,
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
): () => void {
  const channel = client
    .channel(`fund:${editionId}:aggregate`)
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
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

export type { FundAggregate, FundEdition };
