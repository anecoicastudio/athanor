import { describe, expect, it, vi } from 'vitest';
import { asClient, makeFakeClient } from './test-support/fake-client';
import { channelTopic, sharedRoom, type RoomBuild, type SharedRoom } from './realtime';

const TOPIC = 'room:test';

/** A member is any object; these tests only ever need its identity. */
type Member = { id: string };
const member = (id: string): Member => ({ id });

/**
 * The synchronous build every refcount test shares: one channel on the room's topic, no
 * derived state. `client.channel` is the fake's, so the channel it returns is recorded in
 * `fake.channels` and its removal is observable.
 */
const buildOn =
  (fake: ReturnType<typeof makeFakeClient>, topic = TOPIC) =>
  (): RoomBuild => ({ channel: fake.channel(topic) as unknown as RoomBuild['channel'] });

const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('channelTopic', () => {
  it('suffixes every call differently so concurrent subscribers never share a channel', () => {
    const topics = [channelTopic('posts'), channelTopic('posts'), channelTopic('posts')];
    expect(new Set(topics).size).toBe(3);
    expect(topics.every((t) => t.startsWith('posts:'))).toBe(true);
  });
});

describe('sharedRoom', () => {
  describe('the refcount', () => {
    it('builds one channel for the first member and shares it with the rest', () => {
      const fake = makeFakeClient();
      const build = vi.fn(buildOn(fake));
      const join = sharedRoom<Member>(asClient(fake), TOPIC, build);

      join(member('a'));
      join(member('b'));
      join(member('c'));

      expect(build).toHaveBeenCalledTimes(1);
      expect(fake.channels).toHaveLength(1);
      expect(fake.channels[0]!.name).toBe(TOPIC);
    });

    it('keeps the channel while any member remains and removes it on the last leave', () => {
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(asClient(fake), TOPIC, buildOn(fake));

      const leaveA = join(member('a'));
      const leaveB = join(member('b'));

      leaveA();
      expect(fake.channels[0]!.removed).toBe(false);
      leaveB();
      expect(fake.channels[0]!.removed).toBe(true);
    });

    it("a double leave does not steal the survivor's refcount", () => {
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(asClient(fake), TOPIC, buildOn(fake));

      const leaveA = join(member('a'));
      const leaveB = join(member('b'));

      leaveA();
      leaveA();
      expect(fake.channels[0]!.removed).toBe(false);
      leaveB();
      expect(fake.channels[0]!.removed).toBe(true);
    });

    it('builds a fresh room after the last member leaves', () => {
      const fake = makeFakeClient();
      const build = vi.fn(buildOn(fake));
      const join = sharedRoom<Member>(asClient(fake), TOPIC, build);

      join(member('a'))();
      join(member('b'));

      expect(build).toHaveBeenCalledTimes(2);
      expect(fake.channels).toHaveLength(2);
      expect(fake.channels[0]!.removed).toBe(true);
      expect(fake.channels[1]!.removed).toBe(false);
    });

    it('separates rooms per topic and per client', () => {
      const fake = makeFakeClient();
      const other = makeFakeClient();

      sharedRoom<Member>(asClient(fake), TOPIC, buildOn(fake))(member('a'));
      sharedRoom<Member>(asClient(fake), 'room:other', buildOn(fake, 'room:other'))(member('b'));
      sharedRoom<Member>(asClient(other), TOPIC, buildOn(other))(member('c'));

      expect(fake.channels.map((c) => c.name)).toEqual([TOPIC, 'room:other']);
      expect(other.channels.map((c) => c.name)).toEqual([TOPIC]);
    });
  });

  // The invariant #386 exists to settle. Set.add dedupes on reference identity, so a silent
  // collapse would give two subscribers one refcount — and the first cleanup would remove the
  // channel out from under the second. Defended rather than documented: no caller in the tree
  // shares a member object across concurrent subscribes, so the throw names a misuse at the
  // call site that makes it and breaks nothing that exists.
  describe('the member-identity invariant', () => {
    it('refuses a second join with the same member object, naming the topic', () => {
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(asClient(fake), TOPIC, buildOn(fake));
      const shared = member('shared');

      join(shared);
      expect(() => join(shared)).toThrow(/already in the room/);
      expect(() => join(shared)).toThrow(new RegExp(TOPIC));
    });

    it('leaves the first subscriber untouched when the second is refused', () => {
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(asClient(fake), TOPIC, buildOn(fake));
      const shared = member('shared');

      const leave = join(shared);
      expect(() => join(shared)).toThrow();

      expect(fake.channels).toHaveLength(1);
      expect(fake.channels[0]!.removed).toBe(false);
      leave();
      expect(fake.channels[0]!.removed).toBe(true);
    });

    it('allows the same object to rejoin once it has left — only overlap is refused', () => {
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(asClient(fake), TOPIC, buildOn(fake));
      const reused = member('reused');

      join(reused)();
      expect(() => join(reused)).not.toThrow();
      expect(fake.channels).toHaveLength(2);
    });
  });

  // aura's join waits on realtime.setAuth() before it may touch a private topic (#358), so
  // the room outlives a window in which it has members and no channel.
  describe('an async build', () => {
    const buildLater =
      (fake: ReturnType<typeof makeFakeClient>, setAuth: () => Promise<void>) =>
      async (room: SharedRoom<Member>): Promise<RoomBuild | null> => {
        await setAuth();
        if (room.members.size === 0) return null;
        return { channel: fake.channel(TOPIC) as unknown as RoomBuild['channel'] };
      };

    it('registers the room before the join resolves, so overlapping joins share one build', async () => {
      const fake = makeFakeClient();
      const setAuth = vi.fn().mockResolvedValue(undefined);
      const join = sharedRoom<Member>(asClient(fake), TOPIC, buildLater(fake, setAuth));

      join(member('a'));
      join(member('b'));
      expect(fake.channels).toHaveLength(0); // nothing joined before authorisation resolves
      await drain();

      expect(setAuth).toHaveBeenCalledTimes(1);
      expect(fake.channels).toHaveLength(1);
    });

    it('never opens a channel when the last member leaves mid-join', async () => {
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(
        asClient(fake),
        TOPIC,
        buildLater(fake, async () => {}),
      );

      join(member('a'))();
      await drain();

      expect(fake.channels).toHaveLength(0);
    });

    it('removes an orphan channel from a build that opened one anyway', async () => {
      // The net under a build that does not check `members.size` after its await: the room is
      // already out of the registry, so nothing else would ever remove what it hands back.
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(asClient(fake), TOPIC, async () => ({
        channel: fake.channel(TOPIC) as unknown as RoomBuild['channel'],
      }));

      join(member('a'))();
      await drain();

      expect(fake.channels).toHaveLength(1);
      expect(fake.channels[0]!.removed).toBe(true);
    });

    it('leaves cleanly during the window in which the room has no channel yet', async () => {
      const fake = makeFakeClient();
      const join = sharedRoom<Member>(
        asClient(fake),
        TOPIC,
        buildLater(fake, async () => {}),
      );

      const leaveA = join(member('a'));
      const leaveB = join(member('b'));
      expect(() => leaveA()).not.toThrow();
      await drain();

      expect(fake.channels).toHaveLength(1);
      leaveB();
      expect(fake.channels[0]!.removed).toBe(true);
    });
  });

  // `sync` is the one hook a refcount cannot express on its own: state derived from WHICH
  // members are in the room, not how many (presence's single live track()).
  describe('the sync hook', () => {
    const countingBuild = (fake: ReturnType<typeof makeFakeClient>, calls: number[]) => {
      let members = 0;
      return (room: SharedRoom<Member>): RoomBuild => ({
        channel: fake.channel(TOPIC) as unknown as RoomBuild['channel'],
        sync: () => {
          members = room.members.size;
          calls.push(members);
        },
      });
    };

    it('runs after the build, after every join and after every leave', () => {
      const fake = makeFakeClient();
      const calls: number[] = [];
      const join = sharedRoom<Member>(asClient(fake), TOPIC, countingBuild(fake, calls));

      const leaveA = join(member('a'));
      join(member('b'));
      leaveA();

      // 0 at build time (the first member joins after it), then one call per join and leave
      expect(calls).toEqual([0, 1, 2, 1]);
    });

    it('is not run for a member the room refused', () => {
      const fake = makeFakeClient();
      const calls: number[] = [];
      const join = sharedRoom<Member>(asClient(fake), TOPIC, countingBuild(fake, calls));
      const shared = member('shared');

      join(shared);
      expect(() => join(shared)).toThrow();

      expect(calls).toEqual([0, 1]);
    });
  });
});
