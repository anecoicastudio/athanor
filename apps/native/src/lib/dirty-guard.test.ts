import { describe, expect, it } from 'vitest';
import { isDraftDirty, shouldGuardExit, type DraftValue } from './dirty-guard';

describe('isDraftDirty — the empty family', () => {
  it('treats every shape of "nothing typed" as equal', () => {
    // A composer that mounts with '' and a baseline captured as null must not read as dirty,
    // or every screen confirms on the way out having lost nothing at all.
    for (const a of ['', null, undefined, []]) {
      for (const b of ['', null, undefined, []]) {
        expect(isDraftDirty(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  it('does not treat whitespace as typed work', () => {
    expect(isDraftDirty('', '   ')).toBe(false);
    expect(isDraftDirty(null, '\n\t ')).toBe(false);
  });

  it('does not treat false or 0 as empty', () => {
    // `false` and `0` are values a member chose, not absence — an event toggled to free
    // (`paid: false`) over a baseline of `null` is a real edit.
    expect(isDraftDirty(null, false)).toBe(true);
    expect(isDraftDirty(null, 0)).toBe(true);
    expect(isDraftDirty(false, 0)).toBe(true);
  });
});

describe('isDraftDirty — strings', () => {
  it('ignores surrounding whitespace only', () => {
    expect(isDraftDirty('ciao', ' ciao ')).toBe(false);
    expect(isDraftDirty('ciao', 'ciao!')).toBe(true);
    // Interior whitespace is content: two words are not one.
    expect(isDraftDirty('ciao mondo', 'ciaomondo')).toBe(true);
  });

  it('is case- and accent-sensitive', () => {
    expect(isDraftDirty('Sogno', 'sogno')).toBe(true);
    expect(isDraftDirty('perche', 'perché')).toBe(true);
  });
});

describe('isDraftDirty — arrays', () => {
  it('compares element-wise and in order', () => {
    expect(isDraftDirty(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(isDraftDirty(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isDraftDirty(['a'], ['a', 'b'])).toBe(true);
    expect(isDraftDirty(['a', 'b'], ['a'])).toBe(true);
  });

  it('sees a staged medium as a change', () => {
    // post-compose stages up to 10 PickedMedia; losing them is the loss the guard exists for.
    const one = [{ uri: 'file://a.jpg', kind: 'image' }];
    const two = [
      { uri: 'file://a.jpg', kind: 'image' },
      { uri: 'file://b.jpg', kind: 'image' },
    ];
    expect(isDraftDirty([], one)).toBe(true);
    expect(isDraftDirty(one, two)).toBe(true);
    expect(isDraftDirty(one, [{ uri: 'file://a.jpg', kind: 'image' }])).toBe(false);
  });
});

describe('isDraftDirty — objects', () => {
  it('compares by the union of keys, so an added key counts', () => {
    expect(isDraftDirty({ a: 1 }, { a: 1 })).toBe(false);
    expect(isDraftDirty({ a: 1 }, { a: 2 })).toBe(true);
    // Present-but-empty on one side only must stay clean, or a defaulted field reads dirty.
    expect(isDraftDirty({ a: 1 }, { a: 1, b: '' })).toBe(false);
    expect(isDraftDirty({ a: 1 }, { a: 1, b: 'x' })).toBe(true);
  });

  it('recurses into nested draft shapes', () => {
    // The candidacy wizard holds one object across 7 steps.
    const base = { story: 'a', budget: { total: 100, notes: '' } };
    expect(isDraftDirty(base, { story: 'a', budget: { total: 100, notes: null } })).toBe(false);
    expect(isDraftDirty(base, { story: 'a', budget: { total: 120, notes: '' } })).toBe(true);
  });
});

describe('isDraftDirty — dates', () => {
  it('compares by instant, not identity', () => {
    // event-create seeds `startsAt` with a fresh Date; a re-render must not read as an edit.
    expect(isDraftDirty(new Date(1_700_000_000_000), new Date(1_700_000_000_000))).toBe(false);
    expect(isDraftDirty(new Date(1_700_000_000_000), new Date(1_700_000_001_000))).toBe(true);
  });

  it('treats an invalid date as its own value rather than throwing', () => {
    expect(isDraftDirty(new Date(NaN), new Date(NaN))).toBe(false);
    expect(isDraftDirty(new Date(1_700_000_000_000), new Date(NaN))).toBe(true);
  });
});

describe('isDraftDirty — mixed and hostile shapes', () => {
  it('a type change is a change', () => {
    expect(isDraftDirty('1', 1)).toBe(true);
    expect(isDraftDirty(['a'], { 0: 'a' })).toBe(true);
  });

  it('survives a self-referential draft instead of blowing the stack', () => {
    // Not expected in a composer, but a comparator that recurses unbounded turns a swipe
    // into a crash, which is a worse outcome than a missed guard.
    const a: Record<string, DraftValue> = { x: 1 };
    a.self = a;
    const b: Record<string, DraftValue> = { x: 1 };
    b.self = b;
    expect(() => isDraftDirty(a, b)).not.toThrow();
  });
});

describe('shouldGuardExit', () => {
  const base = { dirty: true, saving: false, submitted: false, platformOS: 'ios' } as const;

  it('guards a dirty draft on a device', () => {
    expect(shouldGuardExit(base)).toBe(true);
    expect(shouldGuardExit({ ...base, platformOS: 'android' })).toBe(true);
  });

  it('never guards a clean draft', () => {
    expect(shouldGuardExit({ ...base, dirty: false })).toBe(false);
  });

  it('stands down while the draft is being saved', () => {
    // dream-editor pops via `setTimeout(leave, 700)` AFTER a successful write, with the
    // fields still holding the text it just saved. Without this the member is asked to
    // confirm discarding work that is already safely stored.
    expect(shouldGuardExit({ ...base, saving: true })).toBe(false);
  });

  it('stands down once the draft has been submitted', () => {
    expect(shouldGuardExit({ ...base, submitted: true })).toBe(false);
  });

  it('stands down on web, where Alert.alert is a no-op stub', () => {
    // react-native-web renders no Alert at all. Preventing the pop and then showing nothing
    // would strand the member on a screen with no way out — strictly worse than the silent
    // discard this issue is about. Native keeps the guard; the QA harness keeps its exits.
    expect(shouldGuardExit({ ...base, platformOS: 'web' })).toBe(false);
  });

  it('web wins over every other reason to guard', () => {
    expect(
      shouldGuardExit({ dirty: true, saving: false, submitted: false, platformOS: 'web' }),
    ).toBe(false);
  });
});
