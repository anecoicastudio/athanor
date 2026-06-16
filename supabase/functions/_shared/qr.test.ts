import { assertEquals } from 'jsr:@std/assert';
import { signQrToken, verifyQrToken } from './qr.ts';

const SECRET = 'test-secret-do-not-use-in-prod';
const payload = { eid: 'e1', uid: 'u1', iat: 1750000000 };

Deno.test('sign → verify round-trips the payload', async () => {
  const token = await signQrToken(payload, SECRET);
  assertEquals(await verifyQrToken(token, SECRET), payload);
});

Deno.test('a tampered token fails verification', async () => {
  const token = await signQrToken(payload, SECRET);
  const tampered = `${token.split('.')[0]}.AAAA`;
  assertEquals(await verifyQrToken(tampered, SECRET), null);
});

Deno.test('a wrong secret fails verification', async () => {
  const token = await signQrToken(payload, SECRET);
  assertEquals(await verifyQrToken(token, 'other-secret'), null);
});

Deno.test('a malformed sig returns null, never throws', async () => {
  // non-base64 chars + a length%4==1 string both make atob() throw — must be caught → null
  assertEquals(await verifyQrToken('validbody.!!!', SECRET), null);
  assertEquals(await verifyQrToken('validbody.A', SECRET), null);
  assertEquals(await verifyQrToken('', SECRET), null);
  assertEquals(await verifyQrToken('nodot', SECRET), null);
});

Deno.test('a validly-signed but wrong-shaped payload returns null', async () => {
  const token = await signQrToken({ foo: 'bar' } as unknown as typeof payload, SECRET);
  assertEquals(await verifyQrToken(token, SECRET), null);
});
