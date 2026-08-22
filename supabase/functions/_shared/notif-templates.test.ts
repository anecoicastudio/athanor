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
