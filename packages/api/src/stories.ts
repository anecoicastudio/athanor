import { buildStoryRail, type StoryRailPerson, type StoryRailRow } from '@athanor/core';
import {
  type StorySegment,
  type StorySegmentInsert,
  storySegmentInsertSchema,
  storySegmentSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';
import { channelTopic } from './realtime';

export const storyKeys = {
  all: ['stories'] as const,
  rail: () => [...storyKeys.all, 'rail'] as const,
  person: (profileId: string) => [...storyKeys.all, 'person', profileId] as const,
  reactions: (segmentId: string) => [...storyKeys.all, 'reactions', segmentId] as const, // author-only count
};

/** One rail entry: a person with ≥1 unexpired segment, plus their most recent activity time. */
export type { StoryRailPerson } from '@athanor/core';

/**
 * Rows fetched per rail slot. The window has to exceed the rail length or a member posting
 * several segments crowds others out. 4 keeps the default window at the 200 rows this query
 * used before the rail length became a parameter, so the default behaviour is unchanged.
 */
const RAIL_WINDOW_FACTOR = 4;

/**
 * The story rail — members with ≥1 UNEXPIRED (live, not merely pinned) segment, most-recent
 * first, deduped by author. The connection-graph filter ("connections only", frontend §5) is
 * deferred to M5 — until the graph exists the rail is members-wide (RLS already members-only).
 * The caller surfaces "you" first.
 *
 * `people` is the rail length. The wire window is derived from it because rows and people are
 * different quantities — the rail dedupes by author, so a member with several live segments
 * spends several rows on one entry. Fetching exactly `people` rows would let one prolific
 * author starve the rail, and the emptier it looked the busier the community would actually
 * have been. Fetch + delegate only — the derivation is `buildStoryRail` in @athanor/core
 * (api rule: no business logic here).
 */
export async function getStoryRail(client: AthanorClient, people = 50): Promise<StoryRailPerson[]> {
  const { data, error } = await client
    .from('story_segments')
    .select('author_id, created_at, profiles!story_segments_author_id_fkey(handle)')
    .is('deleted_at', null)
    .gt('expires_at', new Date().toISOString()) // live only — exclude pinned-but-expired journey artifacts
    .order('created_at', { ascending: false })
    .limit(people * RAIL_WINDOW_FACTOR); // bounded, never offset (rule #9)
  if (error) throw error;
  return buildStoryRail((data ?? []) as StoryRailRow[], people);
}

export type StoryCursor = { created_at: string; id: string };

/**
 * One person's playable story — their live-or-pinned segments, OLDEST first (natural story
 * progression). Keyset by (created_at, id) ascending (rule #9, never offset).
 */
export async function getPersonStory(
  client: AthanorClient,
  profileId: string,
  cursor?: StoryCursor | null,
  limit = 30,
): Promise<{ segments: StorySegment[]; nextCursor: StoryCursor | null }> {
  let q = client
    .from('story_segments')
    .select('*')
    .eq('author_id', profileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (cursor) {
    q = q.or(keysetFilter('created_at', 'id', cursor.created_at, cursor.id, 'gt'));
  }
  const { data, error } = await q;
  if (error) throw error;
  const segments = (data ?? []).map((row) => storySegmentSchema.parse(row));
  return {
    segments,
    nextCursor: nextCursorOf(segments, limit, (last) => ({
      created_at: last.created_at,
      id: last.id,
    })),
  };
}

/**
 * Create a story segment (owner-only via RLS; expires_at defaults to now()+24h server-side).
 * Bytes are uploaded to the story-segments bucket first. Writes ONLY story_segments — never any
 * Aura/score event (rule #1). TODO(M6): the engine awards points from this domain event.
 *
 * PARKED(story-add): 0 callers — the StoriesViewer "add" button routes to profile compose, not
 * here. Ships with the story-segment-add surface; wire or remove then.
 */
export async function createStorySegment(
  client: AthanorClient,
  insert: StorySegmentInsert,
): Promise<StorySegment> {
  const payload = storySegmentInsertSchema.parse(insert);
  const { data, error } = await client.from('story_segments').insert(payload).select('*').single();
  if (error) throw error;
  return storySegmentSchema.parse(data);
}

/**
 * Pin a step segment to the journey (survives the 24h TTL). `update … set pinned = true` under
 * the owner UPDATE policy. Idempotent.
 */
export async function pinStoryStep(client: AthanorClient, segmentId: string): Promise<void> {
  const { error } = await client
    .from('story_segments')
    .update({ pinned: true })
    .eq('id', segmentId)
    .is('deleted_at', null);
  if (error) throw error;
}

/** Soft-delete an own segment (owner UPDATE policy). Idempotent. */
export async function softDeleteStorySegment(client: AthanorClient, id: string): Promise<void> {
  const { error } = await client
    .from('story_segments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw error;
}

/**
 * The viewer's own ✦ state for a segment (drives lit/unlit). Own-row RLS → never a public
 * count.
 *
 * The `person_id` predicate is explicit rather than left to RLS: `maybeSingle()` errors on
 * more than one row, so relying on the select policy staying own-row-only makes this query
 * break the moment that policy widens (e.g. an author-sees-reactors surface). `personId`
 * defaults to the current session's uid so the single-row shape holds either way; a signed-out
 * viewer has no reaction to read.
 */
export async function getViewerStoryReaction(
  client: AthanorClient,
  segmentId: string,
  personId?: string,
): Promise<boolean> {
  const viewerId = personId ?? (await client.auth.getUser()).data.user?.id;
  if (!viewerId) return false;
  const { data, error } = await client
    .from('story_reactions')
    .select('id')
    .eq('segment_id', segmentId)
    .eq('person_id', viewerId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Toggle the ✦ celebration (insert/delete own row). `personId` is the caller's auth uid — RLS
 * WITH CHECK re-verifies it. Inserting is the M6 domain event (+4); writes only story_reactions,
 * never aura (rule #1). Returns the new lit state. TODO(M6): the engine awards the points.
 */
export async function toggleStoryReaction(
  client: AthanorClient,
  segmentId: string,
  personId: string,
): Promise<boolean> {
  // personId is already the caller's uid here — pass it so the read needs no session lookup.
  const reacted = await getViewerStoryReaction(client, segmentId, personId);
  if (reacted) {
    const { error } = await client
      .from('story_reactions')
      .delete()
      .eq('segment_id', segmentId)
      .eq('person_id', personId);
    if (error) throw error;
    return false;
  }
  const { error } = await client
    .from('story_reactions')
    .insert({ segment_id: segmentId, person_id: personId });
  if (error) throw error;
  return true;
}

/**
 * The author-only ✦ celebration count for a segment (anti-vanity, CLAUDE.md #3). Returns the
 * true total to the segment author and 0 to everyone else (SECURITY DEFINER + author-gated).
 * NEVER render this as a public number — only in the owner path.
 */
export async function getAuthorStoryCount(
  client: AthanorClient,
  segmentId: string,
): Promise<number> {
  const { data, error } = await client.rpc('story_reaction_count', { p_segment_id: segmentId });
  if (error) throw error;
  return data ?? 0;
}

/**
 * Subscribe to new story segments (realtime INSERT) so the rail can surface a fresh ring.
 * Fires `onInsert` with each new row; the caller refreshes `storyKeys.rail()`. Returns a
 * cleanup fn — callers MUST call it on unmount (rule `api.md`).
 */
export function subscribeNewStories(
  client: AthanorClient,
  onInsert: (segment: StorySegment) => void,
): () => void {
  const channel = client
    .channel(channelTopic('public:story_segments:insert'))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'story_segments' },
      (payload) => {
        const parsed = storySegmentSchema.safeParse(payload.new);
        if (parsed.success) onInsert(parsed.data);
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
