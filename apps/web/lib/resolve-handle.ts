import { handleSchema } from '@athanor/schemas';

/**
 * Resolve a URL segment to a handle. Public profile URLs are `/@handle`; the
 * leading `@` is required so arbitrary one-segment paths don't render as profiles.
 * Returns the bare, validated handle or null (caller → notFound()).
 */
export function resolveHandle(segment: string): string | null {
  const decoded = decodeURIComponent(segment);
  if (!decoded.startsWith('@')) return null;
  const parsed = handleSchema.safeParse(decoded.slice(1).toLowerCase());
  return parsed.success ? parsed.data : null;
}
