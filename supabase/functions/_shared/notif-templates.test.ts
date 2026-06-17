import { assertEquals } from 'jsr:@std/assert';
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
