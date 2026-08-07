import { assertEquals } from 'jsr:@std/assert@1';
import { makeFakeDb } from './fake-db.ts';
import {
  _resetVersionGateCacheForTest,
  evaluateVersionGate,
  isVersionBelow,
  requireSupportedVersion,
} from './version-gate.ts';

const MIN = { ios: '1.2.0', android: '1.1.0' };

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/functions/v1/test', { method: 'POST', headers });
}

// --- isVersionBelow (mirror of packages/core/src/boot/version.ts contract) ---

Deno.test('isVersionBelow: strictly lower → true', () => {
  assertEquals(isVersionBelow('1.0.0', '1.2.0'), true);
});

Deno.test('isVersionBelow: equal (and 1.2 == 1.2.0) → false', () => {
  assertEquals(isVersionBelow('1.2', '1.2.0'), false);
});

Deno.test('isVersionBelow: higher → false', () => {
  assertEquals(isVersionBelow('1.3.0', '1.2.0'), false);
});

Deno.test('isVersionBelow: fail-open on missing/garbage input', () => {
  assertEquals(isVersionBelow(null, '1.2.0'), false);
  assertEquals(isVersionBelow('1.0.0', undefined), false);
  assertEquals(isVersionBelow('abc', '1.2.0'), false);
});

// --- evaluateVersionGate (pure) ---

Deno.test('evaluateVersionGate: below platform min → outdated', () => {
  assertEquals(evaluateVersionGate({ version: '1.0.0', platform: 'ios', min: MIN }), 'outdated');
});

Deno.test('evaluateVersionGate: at min → ok', () => {
  assertEquals(evaluateVersionGate({ version: '1.2.0', platform: 'ios', min: MIN }), 'ok');
});

Deno.test('evaluateVersionGate: per-platform min respected', () => {
  assertEquals(evaluateVersionGate({ version: '1.1.0', platform: 'android', min: MIN }), 'ok');
});

Deno.test(
  'evaluateVersionGate: fail-open on missing header, bad platform, or missing config',
  () => {
    assertEquals(evaluateVersionGate({ version: null, platform: 'ios', min: MIN }), 'ok');
    assertEquals(evaluateVersionGate({ version: '0.1.0', platform: 'web', min: MIN }), 'ok');
    assertEquals(evaluateVersionGate({ version: '0.1.0', platform: 'ios', min: null }), 'ok');
  },
);

// --- requireSupportedVersion (transport + config read + cache) ---

Deno.test('requireSupportedVersion: below min → 426 with outdated_client body', async () => {
  _resetVersionGateCacheForTest();
  const db = makeFakeDb({
    'remote_config.select': [{ data: { value: MIN } }],
  });
  const res = await requireSupportedVersion(
    request({ 'x-app-version': '1.0.0', 'x-app-platform': 'ios' }),
    db as never,
  );
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.response.status, 426);
    assertEquals(await res.response.json(), { error: 'outdated_client', minVersion: '1.2.0' });
  }
});

Deno.test('requireSupportedVersion: at min → ok', async () => {
  _resetVersionGateCacheForTest();
  const db = makeFakeDb({ 'remote_config.select': [{ data: { value: MIN } }] });
  const res = await requireSupportedVersion(
    request({ 'x-app-version': '1.2.0', 'x-app-platform': 'ios' }),
    db as never,
  );
  assertEquals(res.ok, true);
});

Deno.test('requireSupportedVersion: missing headers → ok without querying', async () => {
  _resetVersionGateCacheForTest();
  const db = makeFakeDb();
  const res = await requireSupportedVersion(request({}), db as never);
  assertEquals(res.ok, true);
  assertEquals(db.calls.length, 0);
});

Deno.test('requireSupportedVersion: second call hits the 60s cache (one query)', async () => {
  _resetVersionGateCacheForTest();
  const db = makeFakeDb({ 'remote_config.select': [{ data: { value: MIN } }] });
  const req = request({ 'x-app-version': '1.0.0', 'x-app-platform': 'ios' });
  await requireSupportedVersion(req, db as never);
  const second = await requireSupportedVersion(req, db as never);
  assertEquals(second.ok, false);
  assertEquals(db.calls.length, 1);
});

Deno.test(
  'requireSupportedVersion: DB error → ok (fail-open, availability over enforcement)',
  async () => {
    _resetVersionGateCacheForTest();
    const db = makeFakeDb({ 'remote_config.select': [{ error: { message: 'boom' } }] });
    const res = await requireSupportedVersion(
      request({ 'x-app-version': '0.0.1', 'x-app-platform': 'ios' }),
      db as never,
    );
    assertEquals(res.ok, true);
  },
);

Deno.test('requireSupportedVersion: malformed config row → ok (fail-open)', async () => {
  _resetVersionGateCacheForTest();
  const db = makeFakeDb({ 'remote_config.select': [{ data: { value: { ios: 1 } } }] });
  const res = await requireSupportedVersion(
    request({ 'x-app-version': '0.0.1', 'x-app-platform': 'ios' }),
    db as never,
  );
  assertEquals(res.ok, true);
});
