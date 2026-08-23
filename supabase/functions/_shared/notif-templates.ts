// Inline mirror of @athanor/i18n notif.tpl.* — the Deno edge fn can't import the TS i18n
// package. Keep in sync with packages/i18n/src/catalogs/{it,en}.json (title = notif.type.*,
// body = notif.tpl.*; the help* templates title from notif.lead.help instead — their
// recipient is the HELPER, whom the owner-directed dreamMilestone type title would misread).
// push-dispatch composes the push from these; the app renders the same notif.tpl.* for the
// in-app row.
type Locale = 'it' | 'en';
type Tpl = { title: string; body: (p: Record<string, unknown>) => string };

// notif.tpl.warn's `reason` param is a reports.category TOKEN (#313). Mirror of the
// i18n report.reason.* labels — keep in sync with packages/i18n/src/catalogs/{it,en}.json
// the same way TEMPLATES below mirrors notif.tpl.*. An unknown token degrades to itself
// (the tagLabel shape): a category added to the DB before this mirror must still read as
// a word, never as `undefined`.
const REASON_LABELS: Record<Locale, Record<string, string>> = {
  it: {
    selling: 'Vendite aggressive',
    income: 'Promesse di guadagno garantito',
    mlm: 'Reclutamento multilivello',
    harassment: 'Molestie o comportamento offensivo',
    spam: 'Spam o contenuto ingannevole',
    impersonation: 'Identità falsa',
    other: 'Altro',
  },
  en: {
    selling: 'Aggressive selling',
    income: 'Guaranteed-income promises',
    mlm: 'Multi-level recruiting',
    harassment: 'Harassment or abusive behavior',
    spam: 'Spam or misleading content',
    impersonation: 'Fake identity',
    other: 'Something else',
  },
};

function reasonLabel(reason: unknown, locale: Locale): string {
  const token = typeof reason === 'string' ? reason : '';
  return REASON_LABELS[locale][token] ?? token;
}

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
  'notif.tpl.helpAccepted': {
    it: {
      title: 'Il tuo aiuto',
      body: (p) => `${p.name ?? 'Qualcuno'} ha accettato il tuo aiuto.`,
    },
    en: { title: 'Your help', body: (p) => `${p.name ?? 'Someone'} accepted your help.` },
  },
  'notif.tpl.helpConfirmed': {
    it: {
      title: 'Il tuo aiuto',
      body: (p) => `${p.name ?? 'Qualcuno'} ha confermato il tuo aiuto. La tua Aura cresce ✦`,
    },
    en: {
      title: 'Your help',
      body: (p) => `${p.name ?? 'Someone'} confirmed your help. Your Aura grows ✦`,
    },
  },
  'notif.tpl.warn': {
    it: {
      title: 'Un richiamo',
      body: (p) =>
        `Abbiamo confermato una segnalazione: ${reasonLabel(p.reason, 'it')}. Fermati e ripensaci.`,
    },
    en: {
      title: 'A warning',
      body: (p) => `We upheld a report: ${reasonLabel(p.reason, 'en')}. Pause and think it over.`,
    },
  },
  // #129: gdpr_export_jobs status→ready. No params — deliberately no signed URL in the push
  // payload (a push is not a secure channel for a download link); the member opens the app.
  'notif.tpl.gdprExport': {
    it: {
      title: 'I tuoi dati',
      body: () => 'Il tuo archivio è pronto. Scaricalo da Impostazioni → I tuoi dati.',
    },
    en: {
      title: 'Your data',
      body: () => 'Your archive is ready. Download it from Settings → Your data.',
    },
  },
  // #127 — the fund's broadcasts. Titles mirror notif.type.fundMilestone; bodies mirror the
  // five notif.tpl.fund* keys. The *LastDay pair exists because `t()` has no plural support and
  // «Mancano 1 giorni» is not Italian, so the 1-day slot writes the number into the sentence.
  'notif.tpl.fundMilestone': {
    it: {
      title: 'Il fondo',
      body: (p) => `Il fondo ha superato il ${p.pct ?? 0} % dell'obiettivo.`,
    },
    en: { title: 'The fund', body: (p) => `The fund has passed ${p.pct ?? 0}% of its goal.` },
  },
  'notif.tpl.fundAnnounceCountdown': {
    it: {
      title: 'Il fondo',
      body: (p) => `Mancano ${p.days ?? 0} giorni all'annuncio del sogno scelto.`,
    },
    en: {
      title: 'The fund',
      body: (p) => `${p.days ?? 0} days until the chosen dream is announced.`,
    },
  },
  'notif.tpl.fundAnnounceLastDay': {
    it: { title: 'Il fondo', body: () => 'Domani si annuncia il sogno scelto.' },
    en: { title: 'The fund', body: () => 'Tomorrow the chosen dream is announced.' },
  },
  'notif.tpl.fundBallotCountdown': {
    it: {
      title: 'Il fondo',
      body: (p) => `Mancano ${p.days ?? 0} giorni alla chiusura del voto.`,
    },
    en: { title: 'The fund', body: (p) => `${p.days ?? 0} days until voting closes.` },
  },
  'notif.tpl.fundBallotLastDay': {
    it: {
      title: 'Il fondo',
      body: () => 'Il voto chiude domani. Se non hai ancora votato, è il momento.',
    },
    en: {
      title: 'The fund',
      body: () => "Voting closes tomorrow. If you haven't voted yet, now is the time.",
    },
  },
};

const ROUTE: Record<string, string> = {
  moment: 'momenti',
  message: 'chat',
  dreamMilestone: 'dream',
  review: 'reviews',
  eventReminder: 'event',
  projectResponse: 'costellazioni',
  connection: 'connections',
  // #313: the warn has no member-facing destination — the row itself is the outcome. The
  // in-app router (notification-route.ts) returns null; this push route lands on the
  // notification center's home surface.
  moderation: 'trust',
  // #129: the in-app router opens the Data Export modal (Settings → I tuoi dati).
  gdprExport: 'data-export',
  // #127: matches notification-route.ts's arm — every fund broadcast opens the annual screen.
  fundMilestone: 'annual',
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
