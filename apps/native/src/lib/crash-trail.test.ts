import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The trail is only worth having if three properties hold, so each one is asserted here rather
 * than argued for in a comment:
 *
 *  1. `markStep` does not resolve until its write has landed. A fire-and-forget marker dies with
 *     the process exactly like a queued console line — that is the failure mode that would make
 *     the whole feature a no-op (#452), so it gets the deferred-write test below.
 *  2. The store is bounded, and small enough to stay inside AsyncStorage's 1024-byte inline
 *     threshold on iOS so one marker is one atomic file write.
 *  3. Nothing but a declared step name can ever be persisted or read back — not from a mistyped
 *     call site, not from a store somebody poisoned (RUNBOOK §3.5.1).
 *
 * Module state is per-process by design, so a "previous launch" is simulated with
 * `vi.resetModules()` + a re-import against a store that survives it — an unclean shutdown from
 * the module's point of view, since nothing gets a chance to tear down.
 */

const KEY = 'athanor.crash-trail.v1';

const store = vi.hoisted(() => ({
  mem: new Map<string, string>(),
  /** When true, setItem parks until `drain()` — lets a test observe an unlanded write. */
  manual: false,
  pending: [] as (() => void)[],
  failWrites: false,
  readThrows: false,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => {
      if (store.readThrows) throw new Error('storage unavailable');
      return store.mem.get(k) ?? null;
    },
    setItem: (k: string, v: string) =>
      new Promise<void>((resolve, reject) => {
        const commit = () => {
          if (store.failWrites) return reject(new Error('disk full'));
          store.mem.set(k, v);
          resolve();
        };
        if (store.manual) store.pending.push(commit);
        else commit();
      }),
    removeItem: async (k: string) => {
      store.mem.delete(k);
    },
  },
}));

/** A fresh module instance — i.e. a new app launch against the same on-disk store. */
const launch = async () => {
  vi.resetModules();
  return import('./crash-trail');
};

/** Let queued microtasks run without advancing the (faked) clock. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const drain = async () => {
  const queued = store.pending.splice(0);
  for (const commit of queued) commit();
  await settle();
};

const stored = () => (store.mem.has(KEY) ? (JSON.parse(store.mem.get(KEY)!) as unknown) : null);
const storedSteps = () => (stored() as { steps: { s: string; t: number }[] } | null)?.steps ?? [];

beforeEach(() => {
  store.mem.clear();
  store.pending = [];
  store.manual = false;
  store.failWrites = false;
  store.readThrows = false;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-19T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('durability — the property the feature stands on', () => {
  it('does not resolve markStep until the write has actually landed', async () => {
    // If this were fire-and-forget, the marker would still be in flight when the native call
    // that kills the process begins, and the trail would be empty on the next launch — the exact
    // no-op #452 is about. The call site awaits; that await has to mean something.
    const { markStep, readPreviousTrail } = await launch();
    await readPreviousTrail(); // claim the session slot with an ordinary write first

    store.manual = true;
    let resolved = false;
    const marking = markStep('poster.thumbnails').then(() => {
      resolved = true;
    });

    await settle();
    expect(resolved).toBe(false);
    expect(storedSteps()).toEqual([]); // still nothing on disk — a crash here loses the marker

    await drain();
    await marking;
    expect(resolved).toBe(true);
    expect(storedSteps()).toEqual([{ s: 'poster.thumbnails', t: 0 }]);
  });

  it('serialises concurrent markers so a race cannot drop one', async () => {
    const { markStep, readPreviousTrail } = await launch();
    await readPreviousTrail();

    await Promise.all([markStep('poster.player'), markStep('poster.render')]);

    expect(storedSteps().map((e) => e.s)).toEqual(['poster.player', 'poster.render']);
  });

  it('resolves — and keeps going — when the write itself fails', async () => {
    // A diagnostic must never become the reason the work it watches fails.
    const { markStep, readPreviousTrail } = await launch();
    await readPreviousTrail();
    store.failWrites = true;

    await expect(markStep('poster.save')).resolves.toBeUndefined();
  });

  it('starts a session even when the read of the previous one throws', async () => {
    store.readThrows = true;
    const { readPreviousTrail, markStep } = await launch();

    expect(await readPreviousTrail()).toBeNull();
    await markStep('boot.ready');
    expect(storedSteps().map((e) => e.s)).toEqual(['boot.ready']);
  });
});

describe('read-back across an unclean shutdown', () => {
  it('hands the next launch the steps the dead one reached, with their offsets', async () => {
    const first = await launch();
    await first.markStep('poster.player');
    vi.setSystemTime(new Date('2026-08-19T10:00:03.500Z'));
    await first.markStep('poster.thumbnails');
    // …and here the process dies inside generateThumbnailsAsync. Nothing unmounts, nothing flushes.

    const second = await launch();
    const previous = await second.readPreviousTrail();

    expect(previous?.steps).toEqual([
      { s: 'poster.player', t: 0 },
      { s: 'poster.thumbnails', t: 3500 },
    ]);
    expect(previous && second.endedCleanly(previous)).toBe(false);
  });

  it('reports a trail exactly once — a launch that dies early does not resurrect it', async () => {
    const first = await launch();
    await first.markStep('poster.thumbnails');

    const second = await launch();
    expect((await second.readPreviousTrail())?.steps.map((e) => e.s)).toEqual([
      'poster.thumbnails',
    ]);
    // The second launch claimed the slot on read and then died before marking anything, so the
    // third sees an empty run — not the first run's steps a second time.
    const third = await launch();
    expect((await third.readPreviousTrail())?.steps).toEqual([]);
  });

  it('has nothing to report on a first launch', async () => {
    const { readPreviousTrail } = await launch();
    expect(await readPreviousTrail()).toBeNull();
  });

  it('reads the trail once per process however many callers ask', async () => {
    const first = await launch();
    await first.markStep('boot.ready');

    const second = await launch();
    const [a, b] = await Promise.all([second.readPreviousTrail(), second.readPreviousTrail()]);
    expect(a).toBe(b);
  });

  it('treats a backgrounded run as a clean exit and anything else as not', async () => {
    const first = await launch();
    await first.markStep('boot.ready');
    await first.markStep('app.background');

    const second = await launch();
    const previous = await second.readPreviousTrail();
    expect(previous && second.endedCleanly(previous)).toBe(true);
  });

  it('does not call an empty run clean', async () => {
    const first = await launch();
    await first.readPreviousTrail();

    const second = await launch();
    const previous = await second.readPreviousTrail();
    expect(previous?.steps).toEqual([]);
    expect(previous && second.endedCleanly(previous)).toBe(false);
  });
});

describe('bounds', () => {
  it('keeps the newest MAX_STEPS and drops the oldest', async () => {
    const { markStep, readPreviousTrail, MAX_STEPS } = await launch();
    await readPreviousTrail();

    for (let i = 0; i < MAX_STEPS + 5; i++) {
      await markStep(i % 2 === 0 ? 'poster.player' : 'poster.thumbnails');
    }

    const steps = storedSteps();
    expect(steps).toHaveLength(MAX_STEPS);
    // 25 alternating writes: the oldest survivor is call #5 (odd → thumbnails) and the newest is
    // call #24 (even → player). Both ends pinned, so a slice off the wrong end fails here.
    expect(steps[0]?.s).toBe('poster.thumbnails');
    expect(steps[MAX_STEPS - 1]?.s).toBe('poster.player');
  });

  it('stays inside the 1024-byte inline threshold when completely full', async () => {
    // Under RCTInlineValueThreshold (RNCAsyncStorage.mm:21) the value lives in the manifest, so a
    // marker is ONE atomic file write. Over it, iOS writes a value file AND the manifest. This is
    // the assertion to look at before adding a longer step name or raising MAX_STEPS.
    const { TRAIL_STEPS, MAX_STEPS } = await launch();
    const longest = [...TRAIL_STEPS].sort((a, b) => b.length - a.length)[0]!;
    const worstCase = JSON.stringify({
      v: 1,
      startedAt: 1_755_600_000_000,
      steps: Array.from({ length: MAX_STEPS }, () => ({ s: longest, t: 9_999_999 })),
    });

    expect(worstCase.length).toBeLessThan(1024);
  });
});

describe('nothing but a declared step name gets in — or out', () => {
  it('drops a step outside the vocabulary instead of persisting it', async () => {
    const { markStep, readPreviousTrail } = await launch();
    await readPreviousTrail();

    // The type forbids this; the runtime check is what holds when the type is bypassed — an `any`
    // at a call site, a value read from somewhere untyped.
    await markStep('user@example.com' as never);
    await markStep('poster.done');

    expect(storedSteps().map((e) => e.s)).toEqual(['poster.done']);
  });

  it('strips free-form entries a poisoned store hands back', async () => {
    store.mem.set(
      KEY,
      JSON.stringify({
        v: 1,
        startedAt: 1_755_600_000_000,
        steps: [
          { s: 'poster.player', t: 10 },
          { s: 'ciao, come stai? — sono le 10', t: 20 },
          { s: 'poster.done', t: 'later' },
          null,
        ],
      }),
    );

    const { readPreviousTrail, describeTrail } = await launch();
    const previous = await readPreviousTrail();

    expect(previous?.steps).toEqual([{ s: 'poster.player', t: 10 }]);
    expect(describeTrail(previous!)).not.toContain('come stai');
  });

  it('degrades to nothing on unreadable or stale stored data', async () => {
    for (const raw of ['not json at all', JSON.stringify({ v: 99, startedAt: 1, steps: [] })]) {
      store.mem.set(KEY, raw);
      const { readPreviousTrail } = await launch();
      expect(await readPreviousTrail()).toBeNull();
    }

    store.mem.set(KEY, JSON.stringify({ v: 1, startedAt: 'yesterday', steps: [] }));
    expect(await (await launch()).readPreviousTrail()).toBeNull();

    store.mem.set(KEY, JSON.stringify({ v: 1, startedAt: 1, steps: 'nope' }));
    expect(await (await launch()).readPreviousTrail()).toBeNull();
  });
});

describe('describeTrail', () => {
  it('renders the start time and the steps, and says so when there are none', async () => {
    const first = await launch();
    await first.markStep('boot.ready');

    const second = await launch();
    const previous = await second.readPreviousTrail();
    expect(second.describeTrail(previous!)).toBe('2026-08-19T10:00:00.000Z | boot.ready+0ms');

    const third = await launch();
    expect(third.describeTrail((await third.readPreviousTrail())!)).toContain('(no steps reached)');
  });
});
