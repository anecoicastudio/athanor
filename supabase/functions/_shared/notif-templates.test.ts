import { assertEquals } from 'jsr:@std/assert@1';
import { buildPushMessages } from './notif-templates.ts';

const allValid = (_t: string) => true;

Deno.test('localizes the moment template in IT', () => {
  const msgs = buildPushMessages(
    ['ExponentPushToken[a]'],
    {
      type: 'moment',
      templateKey: 'notif.tpl.moment',
      params: { name: 'Sara' },
      entityRef: 'conv1',
      locale: 'it',
    },
    allValid,
  );
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].title, 'Hai un Momento');
  assertEquals(msgs[0].data.route, 'momenti');
});

Deno.test('drops tokens failing the Expo validator', () => {
  const msgs = buildPushMessages(
    ['bad', 'ExponentPushToken[ok]'],
    {
      type: 'moment',
      templateKey: 'notif.tpl.moment',
      params: {},
      entityRef: 'x',
      locale: 'en',
    },
    (t) => t.startsWith('ExponentPushToken'),
  );
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].to, 'ExponentPushToken[ok]');
});

Deno.test('localizes every notification template in IT + EN with interpolation', () => {
  const cases: {
    templateKey: string;
    type: string;
    params: Record<string, unknown>;
    itHas: string;
    enHas: string;
  }[] = [
    {
      templateKey: 'notif.tpl.dreamMilestone',
      type: 'dreamMilestone',
      params: { name: 'Nadia' },
      itHas: 'Nadia',
      enHas: 'Nadia',
    },
    {
      templateKey: 'notif.tpl.review',
      type: 'review',
      params: { name: 'Karim' },
      itHas: 'Karim',
      enHas: 'Karim',
    },
    {
      templateKey: 'notif.tpl.eventReminder',
      type: 'eventReminder',
      params: { title: 'Notte', count: 38 },
      itHas: '38',
      enHas: '38',
    },
    // The t1 slot (#523). Same type, so the route is the same; the sentence is not.
    {
      templateKey: 'notif.tpl.eventReminderSoon',
      type: 'eventReminder',
      params: { title: 'Notte', count: 38 },
      itHas: "un'ora",
      enHas: 'an hour',
    },
    // The org_t1 slot (#522). Same hour as the t1 above and the same type; what distinguishes
    // it is whose event it is, which lives in the TITLE — so this case pins the body's hour and
    // the title assertion below pins the rest.
    {
      templateKey: 'notif.tpl.eventReminderOrganizer',
      type: 'eventReminder',
      params: { title: 'Notte', count: 38 },
      itHas: "un'ora",
      enHas: 'an hour',
    },
    {
      templateKey: 'notif.tpl.projectResponse',
      type: 'projectResponse',
      params: { name: 'Sara', title: 'video' },
      itHas: 'video',
      enHas: 'video',
    },
    {
      templateKey: 'notif.tpl.connection',
      type: 'connection',
      params: { name: 'Lia' },
      itHas: 'Lia',
      enHas: 'Lia',
    },
    {
      templateKey: 'notif.tpl.connectionAccepted',
      type: 'connection',
      params: { name: 'Lia' },
      itHas: '✦',
      enHas: '✦',
    },
    {
      templateKey: 'notif.tpl.helpAccepted',
      type: 'dreamMilestone',
      params: { name: 'Nadia' },
      itHas: 'Nadia',
      enHas: 'Nadia',
    },
    // the Aura-earning transition carries the ✦; helpAccepted (no Aura) must not
    {
      templateKey: 'notif.tpl.helpConfirmed',
      type: 'dreamMilestone',
      params: { name: 'Nadia' },
      itHas: '✦',
      enHas: '✦',
    },
    // #313: `reason` is a reports.category TOKEN — the template must render the label
    {
      templateKey: 'notif.tpl.warn',
      type: 'moderation',
      params: { reason: 'harassment' },
      itHas: 'Molestie o comportamento offensivo',
      enHas: 'Harassment or abusive behavior',
    },
    // #129: fixed body, no params — and never a download URL in the push payload
    {
      templateKey: 'notif.tpl.gdprExport',
      type: 'gdprExport',
      params: {},
      itHas: 'Il tuo archivio è pronto',
      enHas: 'Your archive is ready',
    },
    // #127 — the five fund broadcast templates. The *Countdown pair interpolates {days}; the
    // *LastDay pair writes the number into the sentence, because `t()` has no plural support.
    // The second-person half of each body is asserted separately below.
    {
      templateKey: 'notif.tpl.fundMilestone',
      type: 'fundMilestone',
      params: { pct: 50 },
      // Unspaced in BOTH locales: every other `%` string in either catalog is unspaced
      // (profile.completeness, media.uploading, fund.vote.consensus, retains.percent).
      itHas: '50%',
      enHas: '50%',
    },
    {
      templateKey: 'notif.tpl.fundAnnounceCountdown',
      type: 'fundMilestone',
      params: { days: 7 },
      itHas: '7 giorni',
      enHas: '7 days',
    },
    {
      templateKey: 'notif.tpl.fundAnnounceLastDay',
      type: 'fundMilestone',
      params: {},
      itHas: 'Domani',
      enHas: 'Tomorrow',
    },
    {
      templateKey: 'notif.tpl.fundBallotCountdown',
      type: 'fundMilestone',
      params: { days: 3 },
      itHas: '3 giorni',
      enHas: '3 days',
    },
    {
      templateKey: 'notif.tpl.fundBallotLastDay',
      type: 'fundMilestone',
      params: {},
      itHas: 'domani',
      enHas: 'tomorrow',
    },
  ];
  for (const c of cases) {
    for (const [locale, needle] of [
      ['it', c.itHas],
      ['en', c.enHas],
    ] as const) {
      const msgs = buildPushMessages(
        ['ExponentPushToken[a]'],
        { type: c.type, templateKey: c.templateKey, params: c.params, entityRef: 'x', locale },
        allValid,
      );
      assertEquals(msgs.length, 1, `${c.templateKey} ${locale} builds`);
      assertEquals(
        msgs[0].body.includes(needle),
        true,
        `${c.templateKey} ${locale} interpolates ${needle}`,
      );
      assertEquals(msgs[0].title.length > 0, true, `${c.templateKey} ${locale} has a title`);
    }
  }
});

// #522 — the organiser slot is a different sentence, not a different notification: same type,
// same route as the attendee reminders, and the only place that says whose event it is is the
// title. A regression that pointed the key at the attendee copy would still pass the loop above,
// which only asserts a title exists.
Deno.test(
  'the organiser reminder is titled as the organiser and routes like the attendee ones',
  () => {
    const build = (templateKey: string, locale: 'it' | 'en') =>
      buildPushMessages(
        ['ExponentPushToken[a]'],
        {
          type: 'eventReminder',
          templateKey,
          params: { title: 'Notte', count: 2 },
          entityRef: 'ev-1',
          locale,
        },
        allValid,
      )[0];

    assertEquals(build('notif.tpl.eventReminderOrganizer', 'it').title, 'Il tuo evento');
    assertEquals(build('notif.tpl.eventReminderOrganizer', 'en').title, 'Your event');
    // …and no head-count, unlike both attendee slots. org_t1 joins no rsvps, so it fires for an
    // event nobody has answered yet, and «0 partecipano» an hour before your own event is a
    // metric rather than a wise friend (PRD §4.14). The `count` param stays in the payload —
    // the sweep builds one params object per notification, not per template — and is simply
    // not read by this key, which is what these two pin.
    assertEquals(
      build('notif.tpl.eventReminderOrganizer', 'it').body.includes('partecipano'),
      false,
    );
    assertEquals(build('notif.tpl.eventReminderOrganizer', 'en').body.includes('attending'), false);
    // …and NOT the attendee title, which is what a copy-paste of the neighbouring entry yields.
    assertEquals(build('notif.tpl.eventReminder', 'it').title, 'Promemoria evento');
    assertEquals(
      build('notif.tpl.eventReminderOrganizer', 'it').data.route,
      build('notif.tpl.eventReminderSoon', 'it').data.route,
    );
  },
);

Deno.test('an unknown reason token degrades to itself, never to undefined', () => {
  const msgs = buildPushMessages(
    ['ExponentPushToken[a]'],
    {
      type: 'moderation',
      templateKey: 'notif.tpl.warn',
      params: { reason: 'a_category_this_mirror_never_met' },
      entityRef: 'x',
      locale: 'it',
    },
    allValid,
  );
  assertEquals(msgs[0].body.includes('a_category_this_mirror_never_met'), true);
  assertEquals(msgs[0].body.includes('undefined'), false);
  assertEquals(msgs[0].data.route, 'trust');
});

Deno.test('falls back to IT for an unknown locale and empty for an unknown template', () => {
  assertEquals(
    buildPushMessages(
      ['ExponentPushToken[a]'],
      {
        type: 'moment',
        templateKey: 'notif.tpl.unknown',
        params: {},
        entityRef: 'x',
        locale: 'it',
      },
      allValid,
    ).length,
    0,
  );
});

// #127: the fund broadcast reaches every member at once, so a body reading «undefined» would
// reach every member at once too. The producers always send the param, but a re-send replayed
// from an older enqueue might not — degrade to a number, never to the string 'undefined'.
Deno.test('a fund countdown with no days param degrades to a number, not undefined', () => {
  for (const templateKey of ['notif.tpl.fundAnnounceCountdown', 'notif.tpl.fundBallotCountdown']) {
    for (const locale of ['it', 'en'] as const) {
      const msgs = buildPushMessages(
        ['ExponentPushToken[a]'],
        { type: 'fundMilestone', templateKey, params: {}, entityRef: 'x', locale },
        allValid,
      );
      assertEquals(msgs[0].body.includes('undefined'), false, `${templateKey} ${locale}`);
    }
  }
});

Deno.test('every fund broadcast routes to the annual screen (#127)', () => {
  const msgs = buildPushMessages(
    ['ExponentPushToken[a]'],
    {
      type: 'fundMilestone',
      templateKey: 'notif.tpl.fundMilestone',
      params: { pct: 25 },
      entityRef: 'x',
      locale: 'it',
    },
    allValid,
  );
  assertEquals(msgs[0].data.route, 'annual');
});

// #127 — rule 5: the Athanor voice is second person. These five are the only notif.tpl.* bodies
// whose FACT half is impersonal (the fund's state is not a statement about the member, and a
// «we raised it» framing would claim a contribution most recipients never made — rule 3), so the
// invitation half is what has to carry the address. Asserted, because a later copy edit that
// trimmed these to the bare fact would silently drop the voice from the one type that reaches
// everybody.
Deno.test('every fund broadcast body addresses the member in the second person', () => {
  const secondPerson: Record<string, { it: string; en: string }> = {
    'notif.tpl.fundMilestone': { it: 'Vieni a vedere', en: 'Come see' },
    'notif.tpl.fundAnnounceCountdown': { it: "Tieni d'occhio", en: 'Keep an eye' },
    'notif.tpl.fundAnnounceLastDay': { it: 'Ci sei?', en: 'Will you be there?' },
    'notif.tpl.fundBallotCountdown': { it: 'Se vuoi votare', en: 'If you want to vote' },
    'notif.tpl.fundBallotLastDay': { it: 'Se non hai ancora votato', en: "If you haven't voted" },
  };
  for (const [templateKey, needles] of Object.entries(secondPerson)) {
    for (const locale of ['it', 'en'] as const) {
      const msgs = buildPushMessages(
        ['ExponentPushToken[a]'],
        {
          type: 'fundMilestone',
          templateKey,
          params: { pct: 50, days: 3 },
          entityRef: 'x',
          locale,
        },
        allValid,
      );
      assertEquals(
        msgs[0].body.includes(needles[locale]),
        true,
        `${templateKey} ${locale} addresses the member: expected «${needles[locale]}» in «${msgs[0].body}»`,
      );
    }
  }
});
