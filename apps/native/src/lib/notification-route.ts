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
      // #127: every fund broadcast — milestone or countdown — opens the annual fund screen.
      // Deliberately NOT ref-dependent like eventReminder: there is one non-closed cycle
      // globally (fund_editions_one_active), so the screen resolves it itself and a row whose
      // entity_ref was lost still lands somewhere useful rather than nowhere.
      return '/(modal)/annual';
    case 'projectResponse':
      return '/(tabs)/costellazioni';
    case 'connection':
      return '/(modal)/connections';
    case 'moderation':
      // #313: the warn row IS the outcome — there is no member-facing moderation surface
      // to open, so the tap marks it read and stays put.
      return null;
    case 'gdprExport':
      // #129: the download button lives on the Data Export modal (Settings → I tuoi dati).
      return '/(modal)/data-export';
    case 'reportQueue':
      // #602: the moderation queue is a WEB surface (apps/web /admin) and this app has no
      // admin screen at all — #311 is where one would land, and it is partner-owned. There is
      // nothing here to open, so the row marks itself read and stays put, exactly as
      // 'moderation' does. The copy carries the whole signal: how many are waiting.
      return null;
    default:
      return null;
  }
}
