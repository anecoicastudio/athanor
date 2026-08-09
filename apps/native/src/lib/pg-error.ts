/**
 * A Postgres unique-violation (23505). Two sheets treat it as success rather than
 * failure: you already passed this favor / already offered help on this tappa, so
 * the DB's unique index is confirming the intent, not refusing it.
 */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505'
  );
}
