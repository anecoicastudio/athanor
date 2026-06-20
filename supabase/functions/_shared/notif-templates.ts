// Inline mirror of @athanor/i18n notif.tpl.* — the Deno edge fn can't import the TS i18n
// package. Keep in sync with packages/i18n/src/catalogs/{it,en}.json (title = notif.type.*,
// body = notif.tpl.*). push-dispatch composes the push from these; the app renders the same
// notif.tpl.* for the in-app row.
type Locale = 'it' | 'en';
type Tpl = { title: string; body: (p: Record<string, unknown>) => string };

const TEMPLATES: Record<string, Record<Locale, Tpl>> = {
  'notif.tpl.moment': {
    it: {
      title: 'Hai un Momento',
      body: (p) => `${p.name ?? 'Qualcuno'} ha una forte affinità sul tuo sogno.`,
    },
    en: {
      title: 'You have a Momento',
      body: (p) => `${p.name ?? 'Someone'} has a strong affinity with your dream.`,
    },
  },
  'notif.tpl.message': {
    it: {
      title: 'Nuovo messaggio',
      body: (p) => `${p.name ?? 'Qualcuno'}: ${p.preview ?? ''}`.trim(),
    },
    en: { title: 'New message', body: (p) => `${p.name ?? 'Someone'}: ${p.preview ?? ''}`.trim() },
  },
  'notif.tpl.dreamMilestone': {
    it: {
      title: 'Una tappa del tuo sogno',
      body: (p) => `${p.name ?? 'Qualcuno'} si è offerto come mentor per il tuo sogno.`,
    },
    en: {
      title: 'A milestone of your dream',
      body: (p) => `${p.name ?? 'Someone'} offered to mentor your dream.`,
    },
  },
  'notif.tpl.review': {
    it: {
      title: 'Nuova recensione',
      body: (p) => `${p.name ?? 'Qualcuno'} ti ha lasciato una recensione.`,
    },
    en: { title: 'New review', body: (p) => `${p.name ?? 'Someone'} left you a review.` },
  },
  'notif.tpl.eventReminder': {
    it: {
      title: 'Promemoria evento',
      body: (p) => `«${p.title ?? ''}» è tra poco. ${p.count ?? 0} partecipano.`,
    },
    en: {
      title: 'Event reminder',
      body: (p) => `«${p.title ?? ''}» is coming up. ${p.count ?? 0} attending.`,
    },
  },
  'notif.tpl.fundMilestone': {
    it: {
      title: 'Dai Vita al Tuo Sogno',
      body: (p) => `Il fondo «Dai Vita al Tuo Sogno» ha superato i ${p.amount ?? ''}.`,
    },
    en: {
      title: 'Bring Your Dream to Life',
      body: (p) => `The «Bring Your Dream to Life» fund passed ${p.amount ?? ''}.`,
    },
  },
  'notif.tpl.projectResponse': {
    it: {
      title: 'Risposta',
      body: (p) => `${p.name ?? 'Qualcuno'} ha risposto alla tua ricerca «${p.title ?? ''}».`,
    },
    en: {
      title: 'Response',
      body: (p) => `${p.name ?? 'Someone'} responded to your search «${p.title ?? ''}».`,
    },
  },
  'notif.tpl.connection': {
    it: { title: 'Connessione', body: (p) => `${p.name ?? 'Qualcuno'} vuole connettersi con te.` },
    en: { title: 'Connection', body: (p) => `${p.name ?? 'Someone'} wants to connect with you.` },
  },
  'notif.tpl.connectionAccepted': {
    it: {
      title: 'Connessione',
      body: (p) => `${p.name ?? 'Qualcuno'} ha accettato la tua richiesta ✦`,
    },
    en: { title: 'Connection', body: (p) => `${p.name ?? 'Someone'} accepted your request ✦` },
  },
};

const ROUTE: Record<string, string> = {
  moment: 'momenti',
  message: 'chat',
  dreamMilestone: 'dream',
  review: 'reviews',
  eventReminder: 'event',
  fundMilestone: 'fund',
  projectResponse: 'costellazioni',
  connection: 'connections',
};

export type DispatchInput = {
  type: string;
  templateKey: string;
  params: Record<string, unknown>;
  entityRef: string;
  locale: Locale;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: { type: string; route: string; entity_ref: string };
};

/** Pure: turn validated tokens + a dispatch input into Expo message objects (no I/O). */
export function buildPushMessages(
  tokens: string[],
  input: DispatchInput,
  isExpoToken: (t: string) => boolean,
): ExpoMessage[] {
  const tplSet = TEMPLATES[input.templateKey];
  const tpl = (tplSet && (tplSet[input.locale] ?? tplSet.it)) ?? null;
  if (!tpl) return [];
  const route = ROUTE[input.type] ?? 'momenti';
  return tokens.filter(isExpoToken).map((to) => ({
    to,
    title: tpl.title,
    body: tpl.body(input.params),
    sound: 'default' as const,
    data: { type: input.type, route, entity_ref: input.entityRef },
  }));
}
