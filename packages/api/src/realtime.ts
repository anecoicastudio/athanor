import type { RealtimeChannel } from '@supabase/supabase-js';
import type { AthanorClient } from './client';

let seq = 0;

/**
 * Unique realtime channel topic. supabase realtime-js caches one channel per
 * topic and throws `cannot add 'postgres_changes' callbacks ... after subscribe()`
 * when a second concurrent subscriber calls `.on()` on the shared, already-
 * subscribed channel. A monotonic per-call suffix gives every subscriber its own
 * channel + independent cleanup. RLS (not the topic) scopes the data, so the
 * label is free to vary. Do NOT use for private broadcast channels whose topic
 * is a server-side address (see aura).
 */
export function channelTopic(base: string): string {
  seq += 1;
  return `${base}:${seq}`;
}

/**
 * The room `build` is handed. `channel` is null until the build settles — an async
 * build (aura's setAuth-gated private join) leaves a window in which the room is
 * registered and the channel does not exist yet. `members` is the refcount itself:
 * the room lives exactly as long as it is non-empty, so a build reads it to decide
 * whether joining is still worth doing, and to dispatch an event to every subscriber.
 */
export type SharedRoom<M> = {
  channel: RealtimeChannel | null;
  members: Set<M>;
};

/**
 * What a `build` hands back. `sync` is optional and runs once as soon as the build
 * settles — with the room still empty, since the first member joins after it — and then
 * after every join and every leave. It is where a room reconciles state *derived* from
 * the member set, which is the one thing a refcount alone cannot express (presence's one
 * live `track()` per room, dropped when the last tracker leaves). It must therefore be
 * safe to call against any member set, empty included. Rooms with no derived state omit it.
 */
export type RoomBuild = {
  channel: RealtimeChannel;
  sync?: () => void;
};

type Room<M> = SharedRoom<M> & { sync?: () => void };

/**
 * One registry per client, one room per topic; WeakMap so a discarded client takes its
 * rooms with it. The member type varies per caller and cannot be named once here, so the
 * map is held opaquely and narrowed at the single read below.
 */
const registries = new WeakMap<AthanorClient, Map<string, Room<object>>>();

const isThenable = <T>(value: T | PromiseLike<T>): value is PromiseLike<T> =>
  typeof (value as PromiseLike<T> | null)?.then === 'function';

/**
 * A refcounted room shared by every subscriber of one topic on one client, built once
 * and torn down when the last subscriber leaves.
 *
 * Realtime-js caches ONE channel per topic and throws when a second subscriber calls
 * `.on()` on the shared, already-subscribed channel. `channelTopic()` sidesteps that by
 * giving every subscriber its own topic — but two topics here cannot take a suffix: the
 * aura topic is a server-side address the engine broadcasts to, and a presence topic only
 * counts members of the SAME topic, so a suffix would put every subscriber in a private
 * room of one. Both surfaces have overlapping mounts as the normal case, so both need
 * this: `.on()` attached once, dispatch to the live member set, `removeChannel` only on
 * the way out (#358, #386).
 *
 * `build` is the only thing that varies. It may be async — the room is registered
 * synchronously *before* it runs, which is what serialises overlapping joins onto one
 * join rather than racing into two builds — and may return null to abort.
 *
 * **A member object may be in a room only once, and a second join with the same object
 * throws.** The refcount keys on object identity, so a silent collapse would let the
 * first cleanup tear the channel out from under the second subscriber. Callers pass a
 * fresh object per subscribe; reusing one *after* its cleanup is fine, only overlap is not.
 */
export function sharedRoom<M extends object>(
  client: AthanorClient,
  topic: string,
  build: (room: SharedRoom<M>) => RoomBuild | null | PromiseLike<RoomBuild | null>,
): (member: M) => () => void {
  return (member: M) => {
    let byTopic = registries.get(client);
    if (!byTopic) {
      byTopic = new Map();
      registries.set(client, byTopic);
    }
    const clientRooms = byTopic;

    let room = clientRooms.get(topic) as Room<M> | undefined;
    if (!room) {
      const created: Room<M> = { channel: null, members: new Set() };
      clientRooms.set(topic, created);
      room = created;

      const attach = (built: RoomBuild) => {
        created.channel = built.channel;
        created.sync = built.sync;
        built.sync?.();
      };

      const built = build(created);
      if (isThenable(built)) {
        void Promise.resolve(built).then((settled) => {
          if (!settled) return;
          // Everyone left while the join was in flight, so the room is already out of the
          // registry and this channel has no owner. A build that can abort should return
          // null before opening a channel at all (aura does, and its test asserts that no
          // channel is ever created); this is the net under one that does not.
          if (created.members.size === 0) {
            void client.removeChannel(settled.channel);
            return;
          }
          attach(settled);
        });
      } else if (built) {
        attach(built);
      }
    }

    const joined = room;
    if (joined.members.has(member)) {
      throw new Error(
        `sharedRoom(${topic}): this subscriber is already in the room. The refcount keys on ` +
          `object identity, so a second join with the same object would collapse into the ` +
          `first and the first cleanup would remove the channel out from under the second. ` +
          `Pass a distinct object per subscribe.`,
      );
    }
    joined.members.add(member);
    joined.sync?.();

    let done = false;
    return () => {
      if (done) return;
      done = true;
      joined.members.delete(member);
      joined.sync?.();
      if (joined.members.size > 0) return;
      // Only if this room is still the registered one: a room that has already been
      // replaced must not evict its successor's entry on the way out.
      if (clientRooms.get(topic) === joined) clientRooms.delete(topic);
      if (joined.channel) {
        void client.removeChannel(joined.channel);
        joined.channel = null;
      }
    };
  };
}
