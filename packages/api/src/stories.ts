import {
  type StorySegment,
  type StorySegmentInsert,
  storySegmentInsertSchema,
  storySegmentSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const storyKeys = {
  all: ['stories'] as const,
  rail: () => [...storyKeys.all, 'rail'] as const,
  person: (profileId: string) => [...storyKeys.all, 'person', profileId] as const,
  reactions: (segmentId: string) => [...storyKeys.all, 'reactions', segmentId] as const, // author-only count
};

/** One rail entry: a person with ≥1 unexpired segment, plus their most recent activity time. */
export type StoryRailPerson = { author_id: string; handle: string | null; latest_at: string };

/**
 * The story rail — members with ≥1 UNEXPIRED (live, not merely pinned) segment, most-recent
 * first, deduped by author. The connection-graph filter ("connections only", frontend §5) is
 * deferred to M5 — until the graph exists the rail is members-wide (RLS already members-only).
 * Capped (rule #9: bounded, never offset). The caller surfaces "you" first.
 */
export async function getStoryRail(client: AthanorClient, limit = 50): Promise<StoryRailPerson[]> {
  const { data, error } = await client
    .from('story_segments')
    .select('author_id, created_at, profiles!story_segments_author_id_fkey(handle)')
    .is('deleted_at', null)
    .gt('expires_at', new Date().toISOString()) // live only — exclude pinned-but-expired journey artifacts
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const seen = new Set<string>();
  const rail: StoryRailPerson[] = [];
  for (const row of data ?? []) {
    const r = row as {
      author_id: string;
      created_at: string;
      profiles: { handle: string | null } | { handle: string | null }[] | null;
    };
    if (seen.has(r.author_id)) continue;
    seen.add(r.author_id);
    const raw = r.profiles;
    const profile = Array.isArray(raw) ? raw[0] : raw;
    rail.push({ author_id: r.author_id, handle: profile?.handle ?? null, latest_at: r.created_at });
    if (rail.length >= limit) break;
  }
  return rail;
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
    q = q.or(
      `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`,
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  const segments = (data ?? []).map((row) => storySegmentSchema.parse(row));
  const last = segments.length === limit ? segments.at(-1) : undefined;
  return { segments, nextCursor: last ? { created_at: last.created_at, id: last.id } : null };
}

/**
 * Create a story segment (owner-only via RLS; expires_at defaults to now()+24h server-side).
 * Bytes are uploaded to the story-segments bucket first. Writes ONLY story_segments — never any
 * Aura/score event (rule #1). TODO(M6): the engine awards points from this domain event.
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

/** The viewer's own ✦ state for a segment (drives lit/unlit). Own-row RLS → never a public count. */
export async function getViewerStoryReaction(
  client: AthanorClient,
  segmentId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('story_reactions')
    .select('id')
    .eq('segment_id', segmentId)
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
  const reacted = await getViewerStoryReaction(client, segmentId);
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
    .channel('public:story_segments:insert')
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
