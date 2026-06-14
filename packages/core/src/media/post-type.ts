import type { MediaKind, PostType } from '@athanor/schemas';

/**
 * The single post `type` for a set of attached media kinds. Precedence
 * video > audio > image > text — a post is labelled by its richest medium.
 */
export function derivePostType(kinds: readonly MediaKind[]): PostType {
  if (kinds.includes('video')) return 'video';
  if (kinds.includes('audio')) return 'audio';
  if (kinds.includes('image')) return 'image';
  return 'text';
}
