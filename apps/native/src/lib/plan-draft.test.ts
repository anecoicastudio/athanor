import { describe, expect, it } from 'vitest';
import type { RealizationPlanPhaseRow } from '@athanor/api';
import {
  applyOrder,
  costedCents,
  type DraftPhase,
  draftFromPhases,
  phaseComplete,
  phaseDiff,
} from './plan-draft';

const row = (over: Partial<RealizationPlanPhaseRow> & { id: string }): RealizationPlanPhaseRow => ({
  plan_id: '00000000-0000-0000-0000-0000000000a1',
  sort: 1,
  title: 'Allestimento',
  scheduled_for: '2026-11-01',
  amount_cents: 20000,
  verification_criteria: 'Contratto firmato.',
  verified_at: null,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  ...over,
});

const draft = (over: Partial<DraftPhase> & { key: string }): DraftPhase => ({
  id: null,
  title: 'Allestimento',
  scheduledFor: '2026-11-01',
  amountCents: 20000,
  criteria: 'Contratto firmato.',
  ...over,
});

describe('draftFromPhases', () => {
  it('reads phases in plan order, whatever order they arrive in', () => {
    const phases = draftFromPhases([
      row({ id: 'b', sort: 2, title: 'Apertura' }),
      row({ id: 'a', sort: 1 }),
    ]);
    expect(phases.map((p) => p.id)).toEqual(['a', 'b']);
    expect(phases[0]?.key).toBe('a');
  });
});

describe('costedCents', () => {
  it('sums what the phases promise', () => {
    expect(costedCents([draft({ key: '1' }), draft({ key: '2', amountCents: 25000 })])).toBe(45000);
  });

  it('counts an unparsed amount as nothing rather than as NaN', () => {
    expect(costedCents([draft({ key: '1', amountCents: null })])).toBe(0);
  });
});

describe('phaseComplete', () => {
  it('needs all four facts a tranche release reads', () => {
    expect(phaseComplete(draft({ key: '1' }))).toBe(true);
    expect(phaseComplete(draft({ key: '1', title: '   ' }))).toBe(false);
    expect(phaseComplete(draft({ key: '1', scheduledFor: '' }))).toBe(false);
    expect(phaseComplete(draft({ key: '1', amountCents: null }))).toBe(false);
    expect(phaseComplete(draft({ key: '1', criteria: ' ' }))).toBe(false);
  });

  it('refuses a zero-euro phase — a phase IS a tranche', () => {
    expect(phaseComplete(draft({ key: '1', amountCents: 0 }))).toBe(false);
  });
});

describe('phaseDiff', () => {
  it('inserts a phase that has no server row yet, numbered by its position', () => {
    const diff = phaseDiff([], [draft({ key: 'new', title: 'Prima' })]);
    expect(diff.inserts).toEqual([
      {
        sort: 1,
        title: 'Prima',
        scheduled_for: '2026-11-01',
        amount_cents: 20000,
        verification_criteria: 'Contratto firmato.',
      },
    ]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it('re-costs an existing phase IN PLACE — never a delete plus an insert', () => {
    const server = [row({ id: 'a' })];
    const diff = phaseDiff(server, [draft({ key: 'a', id: 'a', amountCents: 15000 })]);
    expect(diff.deletes).toEqual([]);
    expect(diff.inserts).toEqual([]);
    expect(diff.updates).toEqual([
      {
        id: 'a',
        patch: {
          sort: 1,
          title: 'Allestimento',
          scheduled_for: '2026-11-01',
          amount_cents: 15000,
          verification_criteria: 'Contratto firmato.',
        },
      },
    ]);
  });

  it('writes nothing for a phase that did not change', () => {
    const server = [row({ id: 'a' })];
    const diff = phaseDiff(server, draftFromPhases(server));
    expect(diff).toEqual({ deletes: [], updates: [], inserts: [] });
  });

  it('deletes the phases the author removed, and renumbers what is left', () => {
    const server = [row({ id: 'a', sort: 1 }), row({ id: 'b', sort: 2, title: 'Apertura' })];
    const diff = phaseDiff(server, [draft({ key: 'b', id: 'b', title: 'Apertura' })]);
    expect(diff.deletes).toEqual(['a']);
    expect(diff.updates.map((u) => [u.id, u.patch.sort])).toEqual([['b', 1]]);
  });

  it('orders renumbering updates by target position so no two phases share a slot', () => {
    const server = [
      row({ id: 'a', sort: 1 }),
      row({ id: 'b', sort: 2, title: 'B' }),
      row({ id: 'c', sort: 3, title: 'C' }),
    ];
    const diff = phaseDiff(server, [
      draft({ key: 'b', id: 'b', title: 'B' }),
      draft({ key: 'c', id: 'c', title: 'C' }),
    ]);
    expect(diff.deletes).toEqual(['a']);
    expect(diff.updates.map((u) => u.patch.sort)).toEqual([1, 2]);
  });

  it('skips an incomplete phase instead of writing half a tranche', () => {
    const diff = phaseDiff([], [draft({ key: 'new', criteria: '' })]);
    expect(diff.inserts).toEqual([]);
  });

  it('trims the prose it writes', () => {
    const diff = phaseDiff([], [draft({ key: 'new', title: '  Prima  ', criteria: ' fatto ' })]);
    expect(diff.inserts[0]?.title).toBe('Prima');
    expect(diff.inserts[0]?.verification_criteria).toBe('fatto');
  });
});

describe('applyOrder', () => {
  it('frees ceiling headroom before asking for more of it', () => {
    expect(applyOrder).toEqual(['deletes', 'updates', 'inserts']);
  });
});
