// deno test supabase/functions/create-verification-session/ — runs in CI (edge job) and locally.
// Characterization tests for the Identity session params + failure shapes. Stripe is injected
// as a capability closure (DI over mocks); no db I/O in this function.
import { assertEquals } from 'jsr:@std/assert@1';
// stripe pinned to major 22: deno.lock is gitignored, so CI resolves fresh on every
// run — an unpinned specifier would typecheck against latest and redden on SDK majors.
import type Stripe from 'npm:stripe@22';
import {
  buildVerificationSessionParams,
  createVerificationSession,
  type VerificationSessionCtx,
} from './logic.ts';

const PROFILE = 'prof-1';

type Ctx = VerificationSessionCtx & {
  created: Stripe.Identity.VerificationSessionCreateParams[];
};

const ctx = (opts: { throwOnCreate?: boolean; url?: string | null } = {}): Ctx => {
  const created: Stripe.Identity.VerificationSessionCreateParams[] = [];
  return {
    createVerificationSession: (params) => {
      created.push(params);
      if (opts.throwOnCreate) return Promise.reject(new Error('stripe down'));
      return Promise.resolve({
        id: 'vs_1',
        url: opts.url === undefined ? 'https://verify.stripe.test/vs_1' : opts.url,
      } as Stripe.Identity.VerificationSession);
    },
    appBase: 'athanor://',
    created,
  };
};

const run = async (c: Ctx, profileId = PROFILE) => {
  const res = await createVerificationSession(c, { profileId });
  return { res, body: await res.json() };
};

Deno.test('happy path → { url } and a document-type session for the caller', async () => {
  const c = ctx();
  const { res, body } = await run(c);
  assertEquals(res.status, 200);
  assertEquals(body, { url: 'https://verify.stripe.test/vs_1' });
  assertEquals(c.created, [
    {
      type: 'document',
      metadata: { profile_id: PROFILE },
      return_url: 'athanor://verify?status=complete',
    },
  ]);
});

Deno.test('profile_id comes from the verified caller, never from a request body', async () => {
  // requireUser → getUser() is the only source of identity (rule #8). The params builder has
  // no other input, so a body-supplied profile_id has nowhere to enter.
  const c = ctx();
  await run(c, 'someone-else');
  assertEquals(c.created[0].metadata, { profile_id: 'someone-else' });
  assertEquals(Object.keys(c.created[0]).sort(), ['metadata', 'return_url', 'type']);
});

Deno.test('return_url honours APP_DEEPLINK_BASE', async () => {
  const c = { ...ctx(), appBase: 'exp://192.168.0.10:8081/--/' };
  await run(c);
  assertEquals(c.created[0].return_url, 'exp://192.168.0.10:8081/--/verify?status=complete');
});

Deno.test('a session without a url → 500 rather than a broken redirect', async () => {
  // Stripe types url as nullable; handing the app a null would surface as a silent no-op tap.
  for (const url of [null, '']) {
    const c = ctx({ url });
    const { res, body } = await run(c);
    assertEquals(res.status, 500);
    assertEquals(body, { error: 'could not start verification' });
  }
});

Deno.test('create throw → clean 500, never Stripe internals', async () => {
  const c = ctx({ throwOnCreate: true });
  const { res, body } = await run(c);
  assertEquals(res.status, 500);
  assertEquals(body, { error: 'could not start verification' });
});

Deno.test('buildVerificationSessionParams is pure and deterministic', () => {
  const a = buildVerificationSessionParams(PROFILE, 'athanor://');
  const b = buildVerificationSessionParams(PROFILE, 'athanor://');
  assertEquals(a, b);
  assertEquals(a.type, 'document');
});
