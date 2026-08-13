import { assertEquals } from 'jsr:@std/assert@1';
import { applyModerationEnforcement, BAN_FOREVER, type EnforceCtx } from './logic.ts';

// Fixed clock — repo convention: the clock is injected, never read inline, so the duration
// arithmetic is assertable to the second.
const NOW = new Date('2026-08-13T12:00:00Z');

function ctx(result: { error: { message: string } | null } = { error: null }) {
  const calls: Array<{ profileId: string; ban_duration: string }> = [];
  const c: EnforceCtx = {
    auth: {
      updateUserById: (profileId, attrs) => {
        calls.push({ profileId, ban_duration: attrs.ban_duration });
        return Promise.resolve(result);
      },
    },
    now: () => NOW,
  };
  return { c, calls };
}

const PROFILE = '7f9c1c1e-3b1a-4a30-9d3b-2f1a5b6c7d8e';

function post(body: unknown): Request {
  return new Request('http://local/moderation-enforce', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

Deno.test('rejects a body that is not JSON', async () => {
  const { c, calls } = ctx();
  const res = await applyModerationEnforcement(
    c,
    new Request('http://local/moderation-enforce', { method: 'POST', body: 'not json' }),
  );
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test('rejects an unknown action and a malformed profileId', async () => {
  const { c, calls } = ctx();
  const bad = await applyModerationEnforcement(c, post({ profileId: PROFILE, action: 'lift' }));
  assertEquals(bad.status, 400);
  const malformed = await applyModerationEnforcement(
    c,
    post({ profileId: 'not-a-uuid', action: 'ban' }),
  );
  assertEquals(malformed.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test(
  'suspend without until is refused — a missing date must never become a lift',
  async () => {
    const { c, calls } = ctx();
    const res = await applyModerationEnforcement(
      c,
      post({ profileId: PROFILE, action: 'suspend' }),
    );
    assertEquals(res.status, 400);
    assertEquals(calls.length, 0);
  },
);

Deno.test('suspend with a past until is refused — GoTrue duration 0 would LIFT a ban', async () => {
  const { c, calls } = ctx();
  const res = await applyModerationEnforcement(
    c,
    post({ profileId: PROFILE, action: 'suspend', until: '2026-08-13T11:59:59Z' }),
  );
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test('suspend maps until to a seconds ban_duration against the injected clock', async () => {
  const { c, calls } = ctx();
  const res = await applyModerationEnforcement(
    c,
    post({ profileId: PROFILE, action: 'suspend', until: '2026-08-20T12:00:00Z' }),
  );
  assertEquals(res.status, 200);
  assertEquals(calls, [{ profileId: PROFILE, ban_duration: `${7 * 24 * 3600}s` }]);
});

Deno.test('ban applies the permanent duration and ignores until', async () => {
  const { c, calls } = ctx();
  const res = await applyModerationEnforcement(
    c,
    post({ profileId: PROFILE, action: 'ban', until: null }),
  );
  assertEquals(res.status, 200);
  assertEquals(calls, [{ profileId: PROFILE, ban_duration: BAN_FOREVER }]);
});

Deno.test('a GoTrue failure surfaces as 502, not a silent 200', async () => {
  const { c } = ctx({ error: { message: 'User not found' } });
  const res = await applyModerationEnforcement(c, post({ profileId: PROFILE, action: 'ban' }));
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error, 'auth update failed: User not found');
});
