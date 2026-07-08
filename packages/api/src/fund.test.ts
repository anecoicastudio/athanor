import { describe, expect, it, vi } from 'vitest';
import { fundKeys, getMyContributions, subscribeFundAggregate } from './fund';

describe('fundKeys', () => {
  it('namespaces under "fund" and distinguishes active vs by-id', () => {
    expect(fundKeys.all).toEqual(['fund']);
    expect(fundKeys.activeEdition()).toEqual(['fund', 'edition', 'active']);
    expect(fundKeys.edition('e1')).toEqual(['fund', 'edition', 'e1']);
    expect(fundKeys.aggregate('e1')).toEqual(['fund', 'aggregate', 'e1']);
  });
});

describe('subscribeFundAggregate', () => {
  it('returns a cleanup fn that removes the channel', () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
    const client = { channel: vi.fn().mockReturnValue(channel), removeChannel: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleanup = subscribeFundAggregate(client as any, 'e1', () => {});
    expect(typeof cleanup).toBe('function');
    cleanup();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});

describe('fundKeys.myContributions', () => {
  it('namespaces under fund/contributions per profile', () => {
    expect(fundKeys.myContributions('p1')).toEqual(['fund', 'contributions', 'p1']);
  });
});

// ---------------------------------------------------------------------------
// getMyContributions — minimal chainable stub (repo api-test style, aura.test.ts)
// ---------------------------------------------------------------------------

const ROW = {
  id: '00000000-0000-4000-8000-000000000001',
  edition_id: '00000000-0000-4000-8000-000000000002',
  profile_id: '00000000-0000-4000-8000-000000000003',
  amount_cents: 500,
  currency: 'eur',
  stripe_checkout_session_id: 'cs_test_1',
  stripe_payment_intent_id: null,
  status: 'succeeded',
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:00:00Z',
};

function makeContribClient(rows: unknown[], captured: { or?: string } = {}) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    or: (expr: string) => {
      captured.or = expr;
      return builder;
    },
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  return { from: () => builder };
}

describe('getMyContributions', () => {
  it('parses rows through fundContributionSchema and returns them', async () => {
    const client = makeContribClient([ROW]);
    const page = await getMyContributions(client as never, 'p1');
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.amount_cents).toBe(500);
    expect(page.rows[0]!.status).toBe('succeeded');
  });

  it('short page → nextCursor null', async () => {
    const client = makeContribClient([ROW]);
    const page = await getMyContributions(client as never, 'p1', { limit: 20 });
    expect(page.nextCursor).toBeNull();
  });

  it('full page → nextCursor is the last row keyset', async () => {
    const second = { ...ROW, id: '00000000-0000-4000-8000-000000000009', created_at: '2026-06-30T10:00:00Z', updated_at: '2026-06-30T10:00:00Z' };
    const client = makeContribClient([ROW, second]);
    const page = await getMyContributions(client as never, 'p1', { limit: 2 });
    expect(page.nextCursor).toEqual({ ts: '2026-06-30T10:00:00Z', id: '00000000-0000-4000-8000-000000000009' });
  });

  it('threads the keyset cursor as a lt/eq-and-lt or() filter — never offset (rule #9)', async () => {
    const captured: { or?: string } = {};
    const client = makeContribClient([], captured);
    await getMyContributions(client as never, 'p1', {
      cursor: { ts: '2026-07-01T10:00:00Z', id: 'abc' },
    });
    expect(captured.or).toBe(
      'created_at.lt.2026-07-01T10:00:00Z,and(created_at.eq.2026-07-01T10:00:00Z,id.lt.abc)',
    );
  });

  it('rejects a malformed row (Zod at the boundary)', async () => {
    const client = makeContribClient([{ ...ROW, status: 'weird' }]);
    await expect(getMyContributions(client as never, 'p1')).rejects.toThrow();
  });
});
