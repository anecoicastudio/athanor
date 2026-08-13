// deno test supabase/functions/stripe-webhook/ — runs in CI (edge job) and locally.
// Needs --allow-read (already in the documented run command).
//
// SPEC-FIRST. docs/PRD.md:382 — "Checkout/Billing session (created by edge fn, **never
// client-side keys**)". docs/PRD.md:406 — "Stripe keys server-side only". CLAUDE.md rule 6 and
// rule 8 say the same, and stripe-best-practices/references/security.md:19,:91 makes it Stripe
// canon: keys never in source, never in client-side code.
//
// Nothing in the repo enforced this. The .claude/settings.json hooks guard migrations, the
// generated types file and literal hex — not a leaked payment key. A grep-shaped test is the
// only mechanism that runs on every CI edge job.
import { assert } from 'jsr:@std/assert@1';

const REPO = new URL('../../../', import.meta.url); // supabase/functions/stripe-webhook → repo root

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  '.expo',
  '.next',
  'dist',
  'build',
  'coverage',
  'ios',
  'android',
  '.scratch',
]);

const SCANNED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|toml|ya?ml|plist|xml)$/;
const isScannable = (name: string) => SCANNED_EXT.test(name) || name.startsWith('.env');

function walk(dir: URL, out: string[] = []): string[] {
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch {
    return out; // directory absent — a scanned tree is optional, never required to exist here
  }
  for (const e of entries) {
    if (e.isDirectory) {
      if (!SKIP_DIRS.has(e.name)) walk(new URL(`${e.name}/`, dir), out);
    } else if (e.isFile && isScannable(e.name)) {
      out.push(new URL(e.name, dir).pathname);
    }
  }
  return out;
}

const read = (p: string) => {
  try {
    return Deno.readTextFileSync(p);
  } catch {
    return '';
  }
};

const rel = (p: string) => p.slice(new URL('.', REPO).pathname.length);

const clientTree = [...walk(new URL('apps/', REPO)), ...walk(new URL('packages/', REPO))];

// Every root this file scans, with a minimum plausible scannable-file count (measured
// 2026-08-13: native 321, web 157, packages 296, supabase 309, scripts 3 — mins sit around
// half, loose enough for refactors and far above zero). walk() swallows a missing directory
// on purpose, so a moved or renamed tree yields an empty scan and a green test — and
// apps/native WAS renamed from apps/mobile once. The old single global threshold
// (clientTree > 100) let packages/ alone clear it, so exactly that rename would have
// passed silently (issue #271, was #143). A scanner that finds nothing must first prove
// it looked at something, PER TREE.
const SCAN_ROOTS: Record<string, number> = {
  'apps/native/': 150,
  'apps/web/': 70,
  'packages/': 140,
  'supabase/': 150,
  'scripts/': 2,
};

Deno.test('every scanned root exists and yields a plausible file count', () => {
  for (const [root, min] of Object.entries(SCAN_ROOTS)) {
    const n = walk(new URL(root, REPO)).length;
    assert(
      n >= min,
      `${root}: expected ≥${min} scannable files, got ${n} — a moved or renamed tree empties this scanner silently`,
    );
  }
});

const isEnvFile = (p: string) => /\/\.env(\.|$)/.test(p);
const allFiles = [
  ...clientTree,
  ...walk(new URL('supabase/', REPO)),
  ...walk(new URL('scripts/', REPO)),
].filter((p) => !p.endsWith('secret-exposure.test.ts')); // this file names the patterns

Deno.test('no LIVE Stripe key exists anywhere on this checkout', () => {
  // security.md:19 — a string matching /[sr]k_live_.*/ IS a live key, wherever it sits. Local
  // .env files are included on purpose: this is the incident-response check, not a style check.
  const LIVE = /\b(sk|rk)_live_[A-Za-z0-9]/;
  const hits = allFiles.filter((p) => LIVE.test(read(p))).map(rel);
  assert(hits.length === 0, `LIVE Stripe key material present: ${hits.join(', ')}`);
});

Deno.test('no Stripe key or webhook secret is committed to source', () => {
  // Test keys and whsec_ secrets belong in the secrets vault or an untracked .env, never in a
  // source file (security.md:19, security.md:21). `.env*` files are exempt because they ARE
  // the sanctioned location — supabase/.env holds a real sk_test_ key, which is correct.
  const KEY_LITERAL = /\b(sk|rk)_(live|test)_[A-Za-z0-9]|\bwhsec_[A-Za-z0-9]/;
  const hits = allFiles.filter((p) => !isEnvFile(p) && KEY_LITERAL.test(read(p))).map(rel);
  assert(hits.length === 0, `Stripe key material committed to source: ${hits.join(', ')}`);
});

Deno.test('no Stripe server secret is reachable from the client bundle', () => {
  // docs/PRD.md:382 — the session is minted by an edge fn, "never client-side keys".
  // apps/native ships its entire source to the device and packages/* are imported by it, so a
  // secret NAME appearing there means a secret VALUE was provisioned within reach of a bundle.
  // apps/web is excluded: it is a Next.js app whose server components legitimately hold server
  // secrets — its client-side halves are covered by the next test instead.
  const SERVER_SECRET =
    /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_RESTRICTED_KEY|SUPABASE_SERVICE_ROLE_KEY/;
  // Per-root population is asserted by the SCAN_ROOTS guard test above.
  const bundled = [...walk(new URL('apps/native/', REPO)), ...walk(new URL('packages/', REPO))];
  const hits = bundled.filter((p) => SERVER_SECRET.test(read(p))).map(rel);
  assert(
    hits.length === 0,
    `server-only secret names reachable from the mobile bundle: ${hits.join(', ')}`,
  );
});

Deno.test('no client component reads a server secret', () => {
  // The Next.js form of the same rule: a 'use client' module is shipped to the browser, so a
  // secret read there is a leak even though the same read is fine one file over.
  const SERVER_SECRET = /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|SUPABASE_SERVICE_ROLE_KEY/;
  const hits = walk(new URL('apps/', REPO))
    .filter((p) => {
      const src = read(p);
      return /^\s*['"]use client['"]/m.test(src) && SERVER_SECRET.test(src);
    })
    .map(rel);
  assert(hits.length === 0, `'use client' module reads a server secret: ${hits.join(', ')}`);
});

Deno.test('edge functions resolve Supabase keys only through _shared/keys.ts', () => {
  // rules/supabase-functions.md (issue #271, was #142): the platform injects
  // SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS as name-keyed JSON, and the legacy
  // SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY only while those keys stay enabled. A
  // direct Deno.env.get on any of them does not throw — it hands JSON (or undefined) to
  // code expecting a key string and surfaces as a confusing 401 at runtime. keys.ts is the
  // one sanctioned reader. SUPABASE_URL is not key material and stays readable anywhere.
  const DIRECT_KEY_READ = /Deno\.env\.get\(\s*['"`]SUPABASE_(?!URL['"`])[A-Z0-9_]+['"`]/;
  const hits = walk(new URL('supabase/functions/', REPO))
    .filter((p) => !p.endsWith('_shared/keys.ts') && !p.endsWith('secret-exposure.test.ts'))
    .filter((p) => DIRECT_KEY_READ.test(read(p)))
    .map(rel);
  assert(hits.length === 0, `SUPABASE_* key read outside _shared/keys.ts: ${hits.join(', ')}`);
});

Deno.test('no app or package imports the server-side Stripe SDK', () => {
  // Importing `stripe` client-side is how a key ends up client-side. The @stripe/* scoped
  // packages (stripe-react-native, stripe-js) are publishable-key SDKs and are fine.
  const SERVER_SDK = /(from\s+['"]stripe['"])|(require\(['"]stripe['"]\))|(['"]npm:stripe)/;
  const hits: string[] = [];
  for (const p of clientTree) {
    if (SERVER_SDK.test(read(p))) hits.push(rel(p));
  }
  assert(hits.length === 0, `server Stripe SDK reachable from the client tree: ${hits.join(', ')}`);
});

Deno.test('no EXPO_PUBLIC_ variable is named like a secret', () => {
  // .claude/rules/mobile.md — "Env: EXPO_PUBLIC_* only. NEVER a service key in this app."
  // EXPO_PUBLIC_* is inlined into the JS bundle at build time, so the name is the whole guard.
  const LEAKY = /EXPO_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE_KEY|_SK_|STRIPE_SK)/;
  const hits: string[] = [];
  for (const p of clientTree) {
    const src = read(p);
    const m = src.match(LEAKY);
    if (m) hits.push(`${rel(p)} (${m[0]})`);
  }
  assert(hits.length === 0, `secret-shaped public env var: ${hits.join(', ')}`);
});
