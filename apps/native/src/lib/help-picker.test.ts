import { describe, expect, it } from 'vitest';
import type { Help, HelpStatus, Milestone, MilestoneStatus } from '@athanor/schemas';
import { helpableMilestones } from './help-picker';

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
