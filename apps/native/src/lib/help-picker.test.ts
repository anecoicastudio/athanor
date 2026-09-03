import { describe, expect, it } from 'vitest';
import type { Help, HelpStatus, Milestone, MilestoneStatus } from '@athanor/schemas';
import { helpableMilestones, isHelpableStatus } from './help-picker';

const milestone = (id: string, status: MilestoneStatus = 'open'): Milestone => ({
  id,
  dream_id: 'dream-1',
  body: `tappa ${id}`,
  status,
  position: 0,
  created_at: '2026-08-11T00:00:00Z',
  updated_at: '2026-08-11T00:00:00Z',
  deleted_at: null,
});

const help = (milestoneId: string, status: HelpStatus): Help => ({
  id: `help-${milestoneId}`,
  milestone_id: milestoneId,
  helper_id: 'helper-1',
  type: 'skill',
  message: null,
  link: null,
  status,
  created_at: '2026-08-11T00:00:00Z',
  updated_at: '2026-08-11T00:00:00Z',
  deleted_at: null,
});

const ids = (ms: Milestone[]) => ms.map((m) => m.id);

describe('helpableMilestones', () => {
  it('has nothing to offer on an empty list', () => {
    expect(helpableMilestones([], [])).toEqual([]);
  });

  it('keeps every open tappa when the helper has offered nothing', () => {
    const ms = [milestone('a'), milestone('b', 'in_progress')];
    expect(ids(helpableMilestones(ms, []))).toEqual(['a', 'b']);
  });

  it('drops done tappe — there is nothing left to help with', () => {
    const ms = [milestone('a', 'done'), milestone('b')];
    expect(ids(helpableMilestones(ms, []))).toEqual(['b']);
  });

  it('drops every tappa when they are all done', () => {
    const ms = [milestone('a', 'done'), milestone('b', 'done')];
    expect(helpableMilestones(ms, [])).toEqual([]);
  });

  // The (milestone_id, helper_id) unique index has no deleted_at partial, so ANY prior row —
  // declined included — makes a second offer a 23505. Every status is excluded, not just the
  // live ones.
  it.each<HelpStatus>(['offered', 'accepted', 'completed', 'declined'])(
    'drops a tappa the helper already has a %s offer on',
    (status) => {
      const ms = [milestone('a'), milestone('b')];
      expect(ids(helpableMilestones(ms, [help('a', status)]))).toEqual(['b']);
    },
  );

  it('ignores a help row pointing at a tappa of some other dream', () => {
    const ms = [milestone('a')];
    expect(ids(helpableMilestones(ms, [help('z', 'offered')]))).toEqual(['a']);
  });

  it('preserves the incoming order of the tappe it keeps', () => {
    const ms = [milestone('a'), milestone('b', 'done'), milestone('c'), milestone('d')];
    expect(ids(helpableMilestones(ms, [help('c', 'declined')]))).toEqual(['a', 'd']);
  });
});

describe('isHelpableStatus', () => {
  // MilestoneRow renders one tappa and holds no list, so it reads the rule through this
  // predicate rather than re-spelling `!== 'done'` a second time. The exhaustive `it.each`
  // is the point: a MilestoneStatus added to the DB enum lands here as a missing case
  // rather than as an «Aiuta» that quietly appears on a state nobody meant to open (#660).
  it.each<[MilestoneStatus, boolean]>([
    ['open', true],
    ['in_progress', true],
    ['done', false],
  ])('reads %s as helpable=%s', (status, expected) => {
    expect(isHelpableStatus(status)).toBe(expected);
  });

  it('agrees with the list filter on every status', () => {
    const statuses: MilestoneStatus[] = ['open', 'in_progress', 'done'];
    const ms = statuses.map((s, i) => milestone(`m${i}`, s));
    expect(ids(helpableMilestones(ms, []))).toEqual(
      ids(ms.filter((m) => isHelpableStatus(m.status))),
    );
  });
});
