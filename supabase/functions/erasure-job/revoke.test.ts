// deno test supabase/functions/erasure-job/ — runs in CI (edge job) and locally.
//
// The transport contract for erasure step (1), which is the contract #542 broke and no test
// held. ./logic.test.ts mocks the auth port, so it pins what the LOOP does with a revoke
// outcome and can say nothing about which SDK call produces one; index.ts is a `Deno.serve`
// shell no test executes. Between the two sat the actual bug: a profile id handed to
// `db.auth.admin.signOut`, which takes «A valid, logged-in JWT» and sends its first argument
// as the `Authorization` bearer — a 401 every time, from the function's creation (2026-06-20)
// until #542 caught it two months later, under a green suite throughout.
//
// So the oracle here is a fake SDK that behaves like the real one on that exact point: its
// `auth.admin.signOut` REJECTS anything that is not JWT-shaped. The differential test below
// runs both the shipped port and the #542 port against it — one passes, the other reproduces
// the 401 — which is what makes the pass meaningful rather than a restatement of the code.
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { type FakeResult, makeFakeDb } from '../_shared/fake-db.ts';
import { REVOKE_SESSIONS_RPC, sessionRevoker } from './revoke.ts';

/** A profile id — what step (1) actually has in hand. Never a JWT. */
const PROFILE_ID = '3f1c7a52-1b0e-4a6f-9f0b-2c4d5e6f7a8b';

/**
 * Stands in for GoTrueAdminApi.signOut at the one property that matters: it authenticates with
 * its first argument, so a value that is not a JWT is a 401 and not a user. Three
 * dot-separated segments is the whole check — a UUID has none, which is the entire mechanism
 * of #542.
 */
const jwtOnlyAdminSignOut = (jwt: string) => {
  if (jwt.split('.').length !== 3) {
    return Promise.reject(new Error(`gotrue 401: bearer is not a JWT (${jwt})`));
  }
  return Promise.resolve({ data: null, error: null });
};

/** makeFakeDb + the `.auth` namespace it does not model, trapped as above. */
const fakeDb = (script: Record<string, FakeResult[]> = {}) => {
  const db = makeFakeDb(script);
  return Object.assign(db, { auth: { admin: { signOut: jwtOnlyAdminSignOut } } });
};

Deno.test('revokes by profile id through the by-id RPC, never through admin.signOut', async () => {
  const db = fakeDb();
  const result = await sessionRevoker(db as unknown as SupabaseClient)(PROFILE_ID);

  // The call actually made: one RPC, by id. Name and argument key are pinned literally — the
  // migration declares `gdpr_revoke_sessions(p_user_id uuid)` and PostgREST matches named
  // arguments exactly, so a rename on either side is a 404 at runtime and must be a red test.
  assertEquals(db.calls.length, 1);
  assertEquals(db.calls[0].table, 'rpc');
  assertEquals(db.calls[0].columns, 'gdpr_revoke_sessions');
  assertEquals(db.calls[0].values, { p_user_id: PROFILE_ID });
  assertEquals(REVOKE_SESSIONS_RPC, 'gdpr_revoke_sessions');

  // Reaching the JWT-only surface at all would have rejected — getting a value back is the
  // assertion that it was not reached.
  assertEquals(result, { error: null });
});

// The other half of the differential, and it checks the ORACLE rather than shipped source: it
// builds the #542 wiring inline, so nothing in ./revoke.ts can turn it red. That is the point —
// it is what proves the case above is not a tautology, by showing the fake demonstrably fails
// the wrong implementation. The guard on the real CALLER is the source assertion below.
Deno.test(
  'oracle check: the fake SDK rejects a profile id, exactly as GoTrue did (#542)',
  async () => {
    const db = fakeDb();
    const oldPort = (profileId: string) => db.auth.admin.signOut(profileId);

    const err = await assertRejects(() => oldPort(PROFILE_ID), Error);
    assertStringIncludes(err.message, 'not a JWT');
    // ...and it never reached the database, which is why no session was ever revoked.
    assertEquals(db.calls.length, 0);
  },
);

Deno.test('a failed revoke is REPORTED, not thrown — the loop degrades on it', async () => {
  const db = fakeDb({ 'rpc.gdpr_revoke_sessions': [{ error: { message: 'permission denied' } }] });

  const result = await sessionRevoker(db as unknown as SupabaseClient)(PROFILE_ID);

  // Resolved with the error, matching every other PostgREST surface — ./logic.ts reads
  // `revokeResult?.error` and only flips `degraded` if this is truthy.
  assert(result?.error, 'a failed RPC must surface as a resolved { error }');
});

// #515/#516 semantics: `partial` claims the run did everything it could. A member who never
// signed in on any device has no session to revoke, and the RPC returns 0 with no error. If
// that read as a failed step, every such erasure would land `failed` — the exact outcome #542
// is about, arriving by a different door.
Deno.test('revoking zero sessions is a success, not a degrade', async () => {
  const db = fakeDb({ 'rpc.gdpr_revoke_sessions': [{ data: 0, error: null }] });

  const result = await sessionRevoker(db as unknown as SupabaseClient)(PROFILE_ID);

  assertEquals(result?.error, null);
});

// ── the guard on the CALLER ──────────────────────────────────────────────────────────────────
// Everything above tests ./revoke.ts. #542 was never in ./revoke.ts — it was in the WIRING, one
// line of index.ts, a file no test executes (it calls Deno.serve at module scope, so importing
// it starts a server). A future edit could re-point the port at db.auth.admin.signOut, or add a
// second JWT-taking port beside it, and every test above would still pass. So the wiring is
// asserted the way _shared/config-invariants.test.ts asserts a posture: over the source text.
// Cheap, and it fails on exactly the edit that would bring #542 back.
Deno.test(
  'index.ts wires the port to sessionRevoker, and reaches no JWT-taking auth call',
  async () => {
    const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
    // Line comments stripped first, because index.ts names the banned call in prose — it says
    // NOT to use it, right above the wiring. A guard that cannot tell code from the comment
    // explaining the guard is a guard nobody can write documentation around. index.ts has no
    // string literal containing `//`, so dropping from the first one per line is sound here.
    const code = source
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    assertStringIncludes(
      code,
      'revokeSessions: sessionRevoker(db)',
      'the erasure auth port must be wired to ./revoke.ts',
    );

    // admin.signOut authenticates with its FIRST argument and step (1) only ever has a profile id
    // to give it. There is no correct way to call it from this file.
    assert(
      !code.includes('admin.signOut'),
      'index.ts must not reach admin.signOut — it takes a JWT, and step (1) has only a profile id (#542)',
    );
  },
);
