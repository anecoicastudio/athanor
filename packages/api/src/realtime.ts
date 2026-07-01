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
