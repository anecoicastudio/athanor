/**
 * Where a tapped notification goes.
 *
 * Two callers, and the second one is why the input is structural rather than a `Notification`:
 * the in-app centre passes a parsed row, while the OS-banner observer (`use-notification-router`)
 * passes a push payload. A push carries `{type, route, entity_ref}` and nothing else — no
 * template_key, no schema-validated enum — so a router keyed on anything richer than this would
 * work in the notification centre and nowhere from the banner, which is the surface members
 * actually tap.
 *
 * The `type` is therefore a plain string. It is a SUPERSET of `NOTIFICATION_TYPES`: 'message' is
 * pushed by `public.on_message_push` as pure transport and never writes a `notifications` row, so
 * it exists in the push route map and not in the DB's type CHECK. `notification-route.mirror.test`
 * asserts this file covers every key of that map.
 */
export type RoutableNotification = {
  type: string;
  entity_ref?: { kind?: string | null; id?: string | null } | null;
};

/**
 * Destination for a tapped notification, or `null` when the right answer is to stay put (the row
 * still marks itself read). Best-effort: a type with no target, or an eventReminder whose
 * entity_ref lost its id, resolves to null rather than to a broken route.
 */
export function routeForNotification(n: RoutableNotification): string | null {
  const ref = n.entity_ref;
  switch (n.type) {
    case 'moment':
      // #637: the DECK, not the match overlay. `/(modal)/match` took no params, so it fell to
      // `source='accepted'`, drew the mutual-match headline with an empty name and a CTA that
      // dismissed itself — for a notification whose own row chip says «Apri Momento». The
      // producer fires on a momento_proposals INSERT (a proposal, not a match), and
      // `momento/[id].tsx` already argues the general case: a Momento is not a per-id surface,
      // the deck IS the viewer. This is also the arm the push route map has always named.
      return '/(tabs)/momenti';
    case 'message':
      // Transport-only type (see the docblock). The ref is the conversation id; without one the
      // thread list is still the honest destination — «someone wrote to you», just not who.
      return ref?.id ? `/(modal)/chat?conversationId=${ref.id}` : '/(modal)/messages';
    case 'review':
      return '/(tabs)/profile';
    case 'dreamMilestone':
      // #637: three templates ride this type and they do NOT face the same way. The offer
      // notifies the dream OWNER, and (tabs)/profile — their own dream, its tappe, the offers
      // they accept from — is right for them. helpAccepted and helpConfirmed notify the HELPER,
      // and sending them to (tabs)/profile meant «Marta ha accettato il tuo aiuto» → your own
      // Aura score. 20260902153058 re-signed those two to carry the owner's profile id, so the
      // ref KIND is what tells the two apart here. Rows written before that migration keep
      // 'milestone_help' and fall through to the old destination, which is why this matches on
      // 'profile' rather than switching wholesale.
      return ref?.kind === 'profile' && ref.id ? `/(modal)/user/${ref.id}` : '/(tabs)/profile';
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
      // The ref names a connection_request row, and the hub opens on its Richieste segment with
      // that inbox already live (RLS-scoped realtime). Passing the id would select a row inside a
      // list the screen renders anyway, so it is dropped on purpose rather than overlooked (#637).
      return '/(modal)/connections';
    case 'moderation':
      // #313: the warn row IS the outcome — there is no member-facing moderation surface
      // to open, so the tap marks it read and stays put.
      return null;
    case 'gdprExport':
      // #129: the download button lives on the Data Export modal (Settings → I tuoi dati).
      // The ref's job id is deliberately unused: that screen queries the member's own job and
      // reads its status and download_url itself, and there is only ever one to resolve (#637).
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

/**
 * The same destination, from the `data` blob of a tapped OS banner (#637 item 1).
 *
 * `entity_ref` crosses as a STRING and arrives in two different spellings, because two producers
 * write it:
 *   - `athanor.enqueue_notification` → the fan-out, which sends the whole ref object
 *     JSON-stringified (`notification-fan-out/logic.ts` — `'{"kind":"momento","id":"…"}'`);
 *   - `public.enqueue_push` → the message push, which sends a bare conversation id.
 * Normalising both here is what lets one router serve the banner and the notification centre, and
 * it is why no edge function had to change: the kind the dreamMilestone arm needs was already on
 * the wire, just not in a shape anything unpacked.
 *
 * Everything is checked rather than asserted — this is remote input arriving through the OS.
 */
export function routeForPushData(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, entity_ref: rawRef } = data as { type?: unknown; entity_ref?: unknown };
  if (typeof type !== 'string' || type === '') return null;
  return routeForNotification({ type, entity_ref: parsePushEntityRef(rawRef) });
}

function parsePushEntityRef(raw: unknown): RoutableNotification['entity_ref'] {
  if (typeof raw !== 'string' || raw === '') return null;
  // A bare id — the enqueue_push spelling. Cheaper than a try/parse and it cannot be confused
  // with the object spelling, which the fan-out always emits starting at '{'.
  if (!raw.startsWith('{')) return { kind: null, id: raw };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { kind, id } = parsed as { kind?: unknown; id?: unknown };
    return {
      kind: typeof kind === 'string' ? kind : null,
      id: typeof id === 'string' && id !== '' ? id : null,
    };
  } catch {
    // '{' that is not JSON: a malformed payload must cost the ROUTE, not the tap. The caller
    // still opens the app; it just cannot say where.
    return null;
  }
}
