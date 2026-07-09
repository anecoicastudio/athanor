// Run via `cd supabase/functions && deno test --allow-env .` (CI edge job).
// requireServiceRole needs --allow-env: the gate reads SUPABASE_SERVICE_ROLE_KEY.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { requireServiceRole, timingSafeEqual } from './auth.ts';

const KEY = 'service-role-test-key';

const reqWithBearer = (bearer?: string) => {
  const headers = new Headers();
  if (bearer !== undefined) headers.set('Authorization', `Bearer ${bearer}`);
  return new Request('http://localhost/fn', { method: 'POST', headers });
};

Deno.test('timingSafeEqual: equal, unequal, differing lengths, empty', () => {
  assert(timingSafeEqual('abc', 'abc'));
  assert(timingSafeEqual('', ''));
  assert(!timingSafeEqual('abc', 'abd'));
  assert(!timingSafeEqual('abc', 'ab'));
  assert(!timingSafeEqual('abc', 'abcd'));
  assert(!timingSafeEqual('', 'a'));
});

Deno.test('requireServiceRole: correct bearer → ok + serviceKey', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY);
  try {
    const gate = requireServiceRole(reqWithBearer(KEY));
    assert(gate.ok);
    assertEquals(gate.serviceKey, KEY);
  } finally {
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
});

Deno.test('requireServiceRole: wrong / missing bearer → 401', () => {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', KEY);
  try {
    for (const req of [reqWithBearer('not-the-key'), reqWithBearer(''), reqWithBearer(undefined)]) {
      const gate = requireServiceRole(req);
      assert(!gate.ok);
      if (!gate.ok) assertEquals(gate.response.status, 401);
    }
  } finally {
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
});

Deno.test('requireServiceRole: env key unset → always 401 (never matches empty)', () => {
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  const gate = requireServiceRole(reqWithBearer(''));
  assert(!gate.ok);
  if (!gate.ok) assertEquals(gate.response.status, 401);
});
