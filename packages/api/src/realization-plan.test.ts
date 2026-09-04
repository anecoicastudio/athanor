import { describe, expect, it, vi } from 'vitest';
import type { AthanorClient } from './client';
import {
  addRealizationPlanPhase,
  createRealizationPlan,
  deleteRealizationPlanPhase,
  getRealizationPlan,
  getRealizationPlanPhases,
  planRefusalOf,
  publishRealizationPlan,
  realizationPlanKeys,
  updateRealizationPlan,
  updateRealizationPlanPhase,
} from './realization-plan';

const EDITION = '00000000-0000-0000-0000-0000000000e1';
const CANDIDACY = '00000000-0000-0000-0000-0000000000c1';
const PLAN = '00000000-0000-0000-0000-0000000000a1';
const PHASE = '00000000-0000-0000-0000-0000000000f1';

const PLAN_ROW = {
  id: PLAN,
  edition_id: EDITION,
  candidacy_id: CANDIDACY,
  objective: 'Aprire il laboratorio.',
  expected_result: 'Trenta persone formate.',
  professionals: '',
  suppliers: '',
  published_at: null,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const PHASE_ROW = {
  id: PHASE,
  plan_id: PLAN,
  sort: 1,
  title: 'Allestimento',
  scheduled_for: '2026-11-01',
  amount_cents: 20000,
  verification_criteria: 'Contratto firmato.',
  verified_at: null,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

/**
 * Thenable PostgREST-builder stub (the votes.test.ts idiom): records the chain, resolves
 * the terminal call with { data, error }. `rows` is what a non-terminal await yields, so an
 * .order() list read and a .single() write read from the same stub.
 */
function stub(data: unknown = null, error: unknown = null) {
  const calls: Array<{ method: string; arg: unknown; arg2?: unknown }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'insert', 'update', 'delete', 'order']) {
    chain[m] = (arg?: unknown, arg2?: unknown) => {
      calls.push({ method: m, arg, arg2 });
      return chain;
    };
  }
  for (const m of ['single', 'maybeSingle']) {
    chain[m] = () => {
      calls.push({ method: m, arg: undefined });
      return Promise.resolve({ data, error });
    };
  }
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve({ data, error });
  const client = { from: () => chain } as unknown as AthanorClient;
  return { client, calls };
}

describe('realizationPlanKeys', () => {
  it('scopes the plan by cycle and the phases by plan', () => {
    expect(realizationPlanKeys.all).toEqual(['realizationPlan']);
    expect(realizationPlanKeys.byEdition(EDITION)).toEqual(['realizationPlan', 'edition', EDITION]);
    expect(realizationPlanKeys.phases(PLAN)).toEqual(['realizationPlan', 'phases', PLAN]);
  });
});

describe('getRealizationPlan', () => {
  it('reads the one plan of a cycle by edition_id', async () => {
    const { client, calls } = stub(PLAN_ROW);
    const plan = await getRealizationPlan(client, EDITION);
    expect(
      calls.some((c) => c.method === 'eq' && c.arg === 'edition_id' && c.arg2 === EDITION),
    ).toBe(true);
    expect(calls.some((c) => c.method === 'maybeSingle')).toBe(true);
    expect(plan?.id).toBe(PLAN);
  });

  it('returns null when there is no plan the caller may see', async () => {
    const { client } = stub(null);
    await expect(getRealizationPlan(client, EDITION)).resolves.toBeNull();
  });

  it('throws on error', async () => {
    const { client } = stub(null, new Error('boom'));
    await expect(getRealizationPlan(client, EDITION)).rejects.toThrow('boom');
  });
});

describe('getRealizationPlanPhases', () => {
  it('orders by sort ascending — plan order, not insertion order', async () => {
    const { client, calls } = stub([PHASE_ROW]);
    const phases = await getRealizationPlanPhases(client, PLAN);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'plan_id' && c.arg2 === PLAN)).toBe(
      true,
    );
    expect(
      calls.some(
        (c) =>
          c.method === 'order' &&
          c.arg === 'sort' &&
          (c.arg2 as { ascending?: boolean }).ascending === true,
      ),
    ).toBe(true);
    expect(phases).toHaveLength(1);
    expect(phases[0]?.amount_cents).toBe(20000);
  });
});

describe('draft writes', () => {
  it('createRealizationPlan inserts the author-supplied shape and returns the parsed row', async () => {
    const { client, calls } = stub(PLAN_ROW);
    const plan = await createRealizationPlan(client, {
      edition_id: EDITION,
      candidacy_id: CANDIDACY,
      objective: 'Aprire il laboratorio.',
      expected_result: 'Trenta persone formate.',
      professionals: '',
      suppliers: '',
    });
    const insert = calls.find((c) => c.method === 'insert');
    expect(insert).toBeDefined();
    expect((insert?.arg as Record<string, unknown>)['published_at']).toBeUndefined();
    expect(plan.published_at).toBeNull();
  });

  it('updateRealizationPlan patches by plan id', async () => {
    const { client, calls } = stub({ ...PLAN_ROW, objective: 'riscritto' });
    const plan = await updateRealizationPlan(client, PLAN, { objective: 'riscritto' });
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === PLAN)).toBe(true);
    expect(plan.objective).toBe('riscritto');
  });

  it('addRealizationPlanPhase surfaces the ceiling refusal instead of clamping', async () => {
    const { client } = stub(null, { message: 'phases exceed declared payable' });
    await expect(
      addRealizationPlanPhase(client, {
        plan_id: PLAN,
        sort: 2,
        title: 'Apertura',
        scheduled_for: '2026-12-01',
        amount_cents: 900000,
        verification_criteria: 'foto',
      }),
    ).rejects.toMatchObject({ message: 'phases exceed declared payable' });
  });

  it('updateRealizationPlanPhase re-costs in place, keeping the phase id', async () => {
    const { client, calls } = stub({ ...PHASE_ROW, amount_cents: 15000 });
    const phase = await updateRealizationPlanPhase(client, PHASE, { amount_cents: 15000 });
    expect(calls.some((c) => c.method === 'update')).toBe(true);
    expect(calls.some((c) => c.method === 'delete')).toBe(false);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === PHASE)).toBe(true);
    expect(phase.id).toBe(PHASE);
  });

  it('deleteRealizationPlanPhase deletes by phase id and throws on error', async () => {
    const { client, calls } = stub(null);
    await deleteRealizationPlanPhase(client, PHASE);
    expect(calls.some((c) => c.method === 'delete')).toBe(true);
    expect(calls.some((c) => c.method === 'eq' && c.arg === 'id' && c.arg2 === PHASE)).toBe(true);

    const failing = stub(null, new Error('boom'));
    await expect(deleteRealizationPlanPhase(failing.client, PHASE)).rejects.toThrow('boom');
  });
});

describe('publishRealizationPlan', () => {
  it('calls the rpc with the plan id and returns the publication timestamp', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '2026-11-01T09:00:00Z', error: null });
    const client = { rpc } as unknown as AthanorClient;
    await expect(publishRealizationPlan(client, PLAN)).resolves.toBe('2026-11-01T09:00:00Z');
    expect(rpc).toHaveBeenCalledWith('publish_realization_plan', { p_plan_id: PLAN });
  });

  it('throws the server refusal rather than reporting a publication', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'plan has no phases' } });
    const client = { rpc } as unknown as AthanorClient;
    await expect(publishRealizationPlan(client, PLAN)).rejects.toMatchObject({
      message: 'plan has no phases',
    });
  });

  it('refuses to report success on a response with no timestamp', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as AthanorClient;
    await expect(publishRealizationPlan(client, PLAN)).rejects.toThrow('no timestamp');
  });
});

describe('planRefusalOf', () => {
  it('finds the named refusal inside the wrapped PostgREST message', () => {
    expect(planRefusalOf({ message: 'publication out of phase' })).toBe('publication out of phase');
    expect(
      planRefusalOf({ message: 'new row violates: phases exceed declared payable (P0001)' }),
    ).toBe('phases exceed declared payable');
  });

  it("is null for anything that is not one of the server's named refusals", () => {
    expect(planRefusalOf({ message: 'permission denied for table realization_plans' })).toBeNull();
    expect(planRefusalOf(new Error('Network request failed'))).toBeNull();
    expect(planRefusalOf(null)).toBeNull();
    expect(planRefusalOf('plan not found')).toBeNull();
  });
});
