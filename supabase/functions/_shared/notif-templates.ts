// Inline mirror of @athanor/i18n notif.tpl.* — the Deno edge fn can't import the TS i18n
// package. Keep in sync with packages/i18n/src/locales/{it,en}.json.
// TODO(M9): unify when notification-fan-out lands (single template source).
type Locale = 'it' | 'en';
type Tpl = { title: string; body: (p: Record<string, unknown>) => string };

const TEMPLATES: Record<string, Record<Locale, Tpl>> = {
  'notif.tpl.moment': {
    it: {
      title: 'Hai un Momento',
      body: (p) => `${p.name ?? 'Qualcuno'} potrebbe essere un Momento per te.`,
    },
    en: {
      title: 'You have a Momento',
      body: (p) => `${p.name ?? 'Someone'} could be a Momento for you.`,
    },
  },
  'notif.tpl.message': {
    it: {
      title: 'Nuovo messaggio',
      body: (p) => `${p.name ?? 'Qualcuno'}: ${p.preview ?? ''}`.trim(),
    },
    en: { title: 'New message', body: (p) => `${p.name ?? 'Someone'}: ${p.preview ?? ''}`.trim() },
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
