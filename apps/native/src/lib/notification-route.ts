import type { Notification } from '@athanor/schemas';

/**
 * Destination for a tapped notification. Best-effort — producers deferred, so a
 * type with no target (or an eventReminder whose entity_ref lost its id) resolves
 * to `null` and the row simply marks itself read without navigating.
 */
export function routeForNotification(n: Notification): string | null {
  const ref = n.entity_ref as { kind?: string; id?: string } | null | undefined;
  switch (n.type) {
    case 'moment':
      return '/(modal)/match';
    case 'review':
      return '/(tabs)/profile';
    case 'dreamMilestone':
      return '/(tabs)/profile';
    case 'eventReminder':
      // event/[id]/index is the event detail route
      return ref?.id ? `/(modal)/event/${ref.id}` : null;
    case 'fundMilestone':
      return '/(modal)/annual';
    case 'projectResponse':
      return '/(tabs)/costellazioni';
    case 'connection':
      return '/(modal)/connections';
    default:
      return null;
  }
}
