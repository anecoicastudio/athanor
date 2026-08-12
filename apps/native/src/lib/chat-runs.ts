/**
 * Where a run of consecutive messages from one sender ends.
 *
 * The chat thread draws the peer's avatar once per run rather than once per bubble (#76), on the
 * LAST bubble, because the gutter is bottom-aligned and that is the row the face lines up with.
 * A day marker between two messages ends the run even when the sender did not change — the
 * marker is a visual break, and a face floating above it reads as a reply to the marker.
 *
 * Pure and structural: it knows only that a row is a message with a sender, so it can be tested
 * without a renderer.
 */
export type RunRow = { type: 'msg'; message: { sender_id: string | null } } | { type: string };

export function isRunEnd(rows: readonly RunRow[], index: number): boolean {
  const current = rows[index];
  if (!current || current.type !== 'msg') return false;
  const next = rows[index + 1];
  if (!next || next.type !== 'msg') return true;
  return (
    (next as { message: { sender_id: string | null } }).message.sender_id !==
    (current as { message: { sender_id: string | null } }).message.sender_id
  );
}
