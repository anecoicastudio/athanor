// Run via `cd supabase/functions && deno test --allow-env --allow-read .` (CI edge job).
//
// GoTrue's auth mails are the first surface a member reads, and nothing tested them.
// `supabase/templates/` is outside every pnpm package, so turbo never sees it; the rule-5
// gate (scripts/check-i18n-hardcoded.mjs) scans apps/ only, so an English stock template
// is invisible to it; and `_shared/config-invariants.test.ts` parses config.toml for
// edge-function postures and never looks at [auth.email.template.*]. A template could be
// deleted, pointed at a missing file, or written in English and every check stayed green.
//
// The specific break this guards against already happened once: magic_link.html shipped a
// `{{ .Token }}` six-digit code as its whole body, while its only caller
// (apps/web/app/admin/login/page.tsx → signInWithOtp → /admin/auth/callback →
// exchangeCodeForSession) needs a link and the product has no field to type a code into.
// A required-variable assertion is what would have caught it.
import { assert, assertEquals } from 'jsr:@std/assert@1';

/**
 * Every mail template this project declares, and the GoTrue variable its flow cannot work
 * without. Adding a `[auth.email.template.<name>]` block to config.toml means adding it
 * here; the parity test fails until you do.
 *
 * Only reachable flows belong here. `recovery` (resetPasswordForEmail), `email_change`
 * (updateUser({email})), `invite` (inviteUserByEmail) and `reauthentication`
 * (secure_password_change = false) have zero call sites in this repo — a template for a
 * mail nothing can send is a file that rots unread.
 */
const DECLARED: Record<string, { requires: readonly string[] }> = {
  // signUp() in apps/native/src/app/(auth)/welcome.tsx; the link lands on
  // src/app/auth-callback.tsx, which exchanges the PKCE code.
  confirmation: { requires: ['ConfirmationURL'] },
  // signInWithOtp() in apps/web/app/admin/login/page.tsx; the link lands on
  // apps/web/app/admin/auth/callback/route.ts, which exchanges the PKCE code.
  magic_link: { requires: ['ConfirmationURL'] },
};

/**
 * The variables GoTrue exposes to a mail template, per
 * https://supabase.com/docs/guides/auth/auth-email-templates. `NewEmail` is the one
 * template-specific member: it exists ONLY in email_change. Using it anywhere else renders
 * an empty string, silently — which is exactly the failure a template test should catch.
 */
const COMMON_VARS = [
  'ConfirmationURL',
  'Token',
  'TokenHash',
  'SiteURL',
  'Email',
  'Data',
  'RedirectTo',
] as const;
const ALLOWED_VARS: Record<string, readonly string[]> = {
  confirmation: COMMON_VARS,
  magic_link: COMMON_VARS,
  invite: COMMON_VARS,
  recovery: COMMON_VARS,
  reauthentication: COMMON_VARS,
  email_change: [...COMMON_VARS, 'NewEmail'],
};

const CONFIG_PATH = new URL('../../config.toml', import.meta.url);
const REPO_ROOT = new URL('../../../', import.meta.url);
const TEMPLATES_DIR = new URL('../../templates/', import.meta.url);

type Declared = { subject: string; contentPath: string };

/**
 * Minimal reader for the `[auth.email.template.<name>]` blocks. Commented-out lines are
 * skipped, so config.toml's stock `# [auth.email.template.invite]` example stays an
 * example rather than becoming a declaration.
 */
function readTemplates(toml: string): Record<string, Declared> {
  const out: Record<string, Declared> = {};
  let current: string | null = null;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    const header = line.match(/^\[auth\.email\.template\.([a-z_]+)\]$/);
    if (header) {
      current = header[1];
      out[current] = { subject: '', contentPath: '' };
      continue;
    }
    if (line.startsWith('[')) {
      current = null;
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^(subject|content_path)\s*=\s*"(.*)"$/);
    if (!kv) continue;
    if (kv[1] === 'subject') out[current].subject = kv[2];
    else out[current].contentPath = kv[2];
  }
  return out;
}

const declared = readTemplates(Deno.readTextFileSync(CONFIG_PATH));

/** `./supabase/templates/x.html` in config.toml is relative to the repo root. */
function resolveContentPath(contentPath: string): URL {
  return new URL(contentPath.replace(/^\.\//, ''), REPO_ROOT);
}

/**
 * A missing content_path is the likeliest real break here — a typo, or a template deleted
 * while its block stayed. Reading it raw throws Deno.errors.NotFound, which reports as an
 * error rather than a failed assertion and buries the path that was wrong. Fail on the
 * assertion instead, naming the file.
 */
function readTemplate(name: string): string {
  const { contentPath } = declared[name];
  const url = resolveContentPath(contentPath);
  try {
    return Deno.readTextFileSync(url);
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `[auth.email.template.${name}] content_path is unreadable: ${contentPath} (${why})`,
    );
  }
}

Deno.test('config.toml declares exactly the templates in DECLARED', () => {
  assertEquals(
    Object.keys(declared).sort(),
    Object.keys(DECLARED).sort(),
    'a [auth.email.template.*] block was added or removed without updating DECLARED',
  );
});

Deno.test('every declared template has a non-empty subject and an existing content_path', () => {
  for (const [name, { subject, contentPath }] of Object.entries(declared)) {
    assert(subject.length > 0, `[auth.email.template.${name}] has no subject`);
    assert(contentPath.length > 0, `[auth.email.template.${name}] has no content_path`);
    const url = resolveContentPath(contentPath);
    let isFile = false;
    try {
      isFile = Deno.statSync(url).isFile;
    } catch {
      isFile = false;
    }
    assert(
      isFile,
      `[auth.email.template.${name}] content_path does not resolve to a file: ${contentPath}`,
    );
  }
});

Deno.test('no orphan template file — every .html in supabase/templates/ is declared', () => {
  const referenced = new Set(
    Object.values(declared).map((d) => resolveContentPath(d.contentPath).pathname),
  );
  for (const entry of Deno.readDirSync(TEMPLATES_DIR)) {
    if (!entry.isFile || !entry.name.endsWith('.html')) continue;
    const url = new URL(entry.name, TEMPLATES_DIR);
    assert(
      referenced.has(url.pathname),
      `supabase/templates/${entry.name} is not referenced by any [auth.email.template.*] block`,
    );
  }
});

Deno.test('each template carries the GoTrue variable its flow cannot work without', () => {
  for (const [name, { requires }] of Object.entries(DECLARED)) {
    const html = readTemplate(name);
    for (const v of requires) {
      assert(
        new RegExp(`\\{\\{\\s*\\.${v}\\s*\\}\\}`).test(html),
        `${declared[name].contentPath} never uses {{ .${v} }} — the mail has nothing to act on`,
      );
    }
  }
});

Deno.test('templates use only variables GoTrue exposes for their type', () => {
  for (const name of Object.keys(DECLARED)) {
    const html = readTemplate(name);
    const allowed = ALLOWED_VARS[name];
    assert(allowed, `no ALLOWED_VARS entry for template '${name}'`);
    for (const m of html.matchAll(/\{\{\s*\.([A-Za-z]+)\s*\}\}/g)) {
      assert(
        allowed.includes(m[1]),
        `${declared[name].contentPath} uses {{ .${m[1]} }}, which GoTrue does not expose to the ` +
          `'${name}' template — it renders as an empty string, silently`,
      );
    }
  }
});

Deno.test('templates declare utf-8 and Italian', () => {
  for (const name of Object.keys(DECLARED)) {
    const html = readTemplate(name);
    // GoTrue does not wrap the template, so a body with no charset renders «è» as mojibake
    // in any client that guesses latin-1.
    assert(
      /<meta\s+charset="utf-8"\s*\/?>/i.test(html),
      `${declared[name].contentPath} declares no utf-8 charset`,
    );
    // Rule 5's substance: IT is canonical. GoTrue holds one template per type per project,
    // so this is also the guard against a stock English template being pasted back in.
    assert(
      /<html\s+lang="it"[\s>]/i.test(html),
      `${declared[name].contentPath} is not marked lang="it"`,
    );
  }
});

Deno.test('templates use the Athanor voice — no metrics vocabulary', () => {
  // rules/i18n.md: never the words "engagement" or "utenti". The product's claim is that
  // people are not metrics, so the copy holds that line too.
  const banned = ['engagement', 'utenti'];
  for (const name of Object.keys(DECLARED)) {
    const html = readTemplate(name);
    for (const word of banned) {
      assert(
        !new RegExp(`\\b${word}\\b`, 'i').test(html),
        `${declared[name].contentPath} contains the banned word "${word}" (rules/i18n.md)`,
      );
    }
  }
});

Deno.test('no secret or project ref is baked into a template', () => {
  // A template is committed, world-readable (the repo is public) and cannot be rotated by
  // editing it after the fact — the hosted copy has to be replaced by hand.
  const forbidden: Array<[RegExp, string]> = [
    [/sb_secret_/, 'a Supabase secret key'],
    [/sb_publishable_/, 'a Supabase publishable key'],
    [/\beyJ[A-Za-z0-9_-]{10,}/, 'a JWT'],
    [/\bsk_(live|test)_/, 'a Stripe secret key'],
    [/[a-z]{20}\.supabase\.(co|in)\b/, 'a hosted project ref'],
  ];
  for (const name of Object.keys(DECLARED)) {
    const html = readTemplate(name);
    for (const [pattern, what] of forbidden) {
      assert(!pattern.test(html), `${declared[name].contentPath} appears to contain ${what}`);
    }
  }
});
