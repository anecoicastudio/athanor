import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  blockKeys,
  connectionKeys,
  dreamKeys,
  momentKeys,
  profileKeys,
  storyKeys,
} from '@athanor/api';
import { blockDependentKeys, invalidateBlockDependents } from './block-cache';

const peer = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';

describe('blockDependentKeys', () => {
  // A key drifting by one character still type-checks and simply stops being reached by the
  // invalidation — the silent failure `query-hooks.test.ts` pins against. So the six are
  // spelled out, not derived.
  it('names every per-person query athanor.not_blocked gates, and nothing else', () => {
    expect(blockDependentKeys(peer)).toEqual([
      ['blocks'],
      ['profiles', peer],
      ['dreams', 'profile', peer],
      ['moments', 'list', peer],
      ['connections', 'status', peer],
      ['stories', 'person', peer],
    ]);
  });

  it('is built from the real factories, so a factory rename cannot leave it behind', () => {
    expect(blockDependentKeys(peer)).toEqual([
      blockKeys.all,
      profileKeys.detail(peer),
      dreamKeys.byProfile(peer),
      momentKeys.list(peer),
      connectionKeys.status(peer),
      storyKeys.person(peer),
    ]);
  });
});

describe('invalidateBlockDependents', () => {
  const seeded = () => {
    const qc = new QueryClient();
    // `null` is what getProfileById returns for a blocked pair — a cached SUCCESS, which is the
    // whole bug: nothing about it looks stale to the next reader.
    qc.setQueryData(profileKeys.detail(peer), null);
    qc.setQueryData(profileKeys.statCounts(peer), { collabs: 0, events: 0 });
    qc.setQueryData(dreamKeys.byProfile(peer), null);
    qc.setQueryData(momentKeys.list(peer), { moments: [], nextCursor: null });
    qc.setQueryData(blockKeys.status(peer), true);
    qc.setQueryData(connectionKeys.status(peer), null);
    qc.setQueryData(storyKeys.person(peer), { segments: [] });
    qc.setQueryData(profileKeys.detail(other), { id: other });
    qc.setQueryData(connectionKeys.status(other), null);
    return qc;
  };

  it('marks the cached null for the peer stale, and the profile of anyone else untouched', () => {
    const qc = seeded();
    invalidateBlockDependents(qc, peer);
    expect(qc.getQueryState(profileKeys.detail(peer))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(profileKeys.detail(other))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(connectionKeys.status(other))?.isInvalidated).toBe(false);
  });

  it('reaches the stat counts by prefix, the dream, the momenti, the block status, the connection and the stories', () => {
    const qc = seeded();
    invalidateBlockDependents(qc, peer);
    for (const key of [
      profileKeys.statCounts(peer),
      dreamKeys.byProfile(peer),
      momentKeys.list(peer),
      blockKeys.status(peer),
      connectionKeys.status(peer),
      storyKeys.person(peer),
    ]) {
      expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
  });

  it('invalidates rather than removes — a mounted profile screen keeps its data to refetch over', () => {
    const qc = seeded();
    invalidateBlockDependents(qc, peer);
    expect(qc.getQueryState(profileKeys.detail(peer))).toBeDefined();
    expect(qc.getQueryState(profileKeys.detail(peer))?.status).toBe('success');
  });
});
