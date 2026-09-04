import {
  type RealizationUpdateEdit,
  type RealizationUpdateInsert,
  type RealizationUpdateRow,
  realizationUpdateSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { keysetFilter, nextCursorOf } from './pagination';

export const realizationUpdateKeys = {
  all: ['realizationUpdate'] as const,
  feed: (editionId: string) => [...realizationUpdateKeys.all, 'feed', editionId] as const,
  mine: (editionId: string) => [...realizationUpdateKeys.all, 'mine', editionId] as const,
};

/** Cursor position in the feed's `(created_at desc, id desc)` order. */
export type RealizationUpdateCursor = { ts: string; id: string };

/** One page of the feed. Small: an update is read, not skimmed. */
export const UPDATES_PAGE_SIZE = 20;

/**
 * The cycle's public progress trail, newest first (#230, FUND-26).
 *
 * Keyset, never offset (rule #9), and here the reason is not theoretical: the author posts
 * while the community reads, so an offset page would skip the row that arrived between two
 * fetches. `realization_updates_feed` is the matching index — (edition_id, created_at desc,
 * id desc) where deleted_at is null — so a deep page costs what the first one does.
 *
 * Withdrawn notes are absent because RLS excludes them, not because this filters: the
 * author's own withdrawn rows are readable to the author under a separate policy, and
 * filtering here would hide them from the one screen that should show them.
 */
export async function getRealizationUpdates(
  client: AthanorClient,
  editionId: string,
  {
    cursor,
    limit = UPDATES_PAGE_SIZE,
    includeWithdrawn = false,
  }: {
    cursor?: RealizationUpdateCursor | null;
    limit?: number;
    includeWithdrawn?: boolean;
  } = {},
): Promise<{ rows: RealizationUpdateRow[]; nextCursor: RealizationUpdateCursor | null }> {
  let q = client.from('realization_updates').select('*').eq('edition_id', editionId);

  // The public feed asks for live rows only. `includeWithdrawn` is the author's own screen,
  // and it widens nothing for anyone else: a stranger passing it true still sees exactly
  // what `realization_updates_select_live` lets them see. The flag chooses which of the
  // caller's OWN visible rows to render, never who may see whose.
  if (!includeWithdrawn) q = q.is('deleted_at', null);

  q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);

  if (cursor) {
    q = q.or(keysetFilter('created_at', 'id', cursor.ts, cursor.id, 'lt'));
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((row) => realizationUpdateSchema.parse(row));
  return {
    rows,
    nextCursor: nextCursorOf(rows, limit, (last) => ({ ts: last.created_at, id: last.id })),
  };
}

/**
 * Post a note. Everything that makes it legitimate is server-side: the insert policy pins
 * `profile_id` to the caller and the cycle to `phase = 'realization'`, and the
 * binds_winner trigger refuses an author who is not the cycle's confirmed winner or a
 * phase that belongs to another cycle.
 *
 * Nothing is pre-checked here. A client-side «are you the winner?» would be a second
 * opinion about who may speak for a funded project, and the one that matters is the
 * database's.
 */
export async function postRealizationUpdate(
  client: AthanorClient,
  input: RealizationUpdateInsert,
): Promise<RealizationUpdateRow> {
  const { data, error } = await client
    .from('realization_updates')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return realizationUpdateSchema.parse(data);
}

/**
 * Correct a note in place. RLS refuses once the cycle leaves realization, and refuses a
 * note that was already withdrawn (`deleted_at is null` is in USING, not in WITH CHECK —
 * which is what lets `deleteRealizationUpdate` below work through the same policy).
 */
export async function editRealizationUpdate(
  client: AthanorClient,
  updateId: string,
  patch: RealizationUpdateEdit,
): Promise<RealizationUpdateRow> {
  const { data, error } = await client
    .from('realization_updates')
    .update(patch)
    .eq('id', updateId)
    .select('*')
    .single();
  if (error) throw error;
  return realizationUpdateSchema.parse(data);
}

/**
 * Withdraw a note: a soft delete, never a hard one. There is no delete grant on the table
 * — a public record of a publicly funded project does not vanish, it stops being shown.
 * The timestamp is the row's own `now()` in Postgres terms only because the client cannot
 * choose it: `deleted_at` is granted, so this sends one, and the value is the moment the
 * author acted.
 */
export async function deleteRealizationUpdate(
  client: AthanorClient,
  updateId: string,
  now: string,
): Promise<void> {
  const { error } = await client
    .from('realization_updates')
    .update({ deleted_at: now })
    .eq('id', updateId);
  if (error) throw error;
}

/**
 * The refusals the realization_updates trigger raises, verbatim. The server's string IS
 * the contract (the `PLAN_REFUSALS` idiom): the screen maps each to copy, so «that phase
 * is another cycle's» never reads as a failed save.
 *
 * An RLS denial is deliberately NOT in this list — it raises no message, it matches no
 * row, and the screen's generic copy is the honest thing to show for it.
 */
export const UPDATE_REFUSALS = [
  'edition not found',
  'no winner declared',
  'not the cycle winner',
  'plan phase not found',
  'plan phase belongs to another cycle',
] as const;
export type UpdateRefusal = (typeof UPDATE_REFUSALS)[number];

/**
 * The named refusal inside a Postgres error, or null when the failure is something else.
 * Matched with `includes` because PostgREST wraps the raised text; 'plan phase not found'
 * is checked after the longer strings can no longer match it, since the list is scanned in
 * order and no two entries are substrings of each other.
 */
export function updateRefusalOf(error: unknown): UpdateRefusal | null {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== 'string') return null;
  return UPDATE_REFUSALS.find((refusal) => message.includes(refusal)) ?? null;
}

export type { RealizationUpdateEdit, RealizationUpdateInsert, RealizationUpdateRow };
