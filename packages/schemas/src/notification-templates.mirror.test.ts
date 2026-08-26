import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TEMPLATE_KEYS } from './notification';

/**
 * `notification.ts` says `NOTIFICATION_TEMPLATE_KEYS` is mirrored in the Deno push mirror
 * `supabase/functions/_shared/notif-templates.ts`, and until now nothing made that true — the
 * word in the comment was "manual". Two copies, and the one nobody can see is the one that
 * ships the push.
 *
 * The drift is silent by construction. `buildPushMessages` looks the key up and returns `[]`
 * when it misses (`if (!tpl) return [];`), which is the right degrade — a member who gets no
 * push is better than a crashed dispatch — but it means a template key added here and not
 * there produces a notification row that appears in the app and never reaches the phone. No
 * error, no log, nothing red. `docs/RELEASE-RUNBOOK.md` §4.4 covers the neighbouring hazard
 * (deploy the function BEFORE the migration that emits the key) and is deliberately about
 * ORDER, not coverage: it cannot tell you the key was never written on either side.
 *
 * `audit-log-actions.mirror.test.ts` closes the same shape of claim against a CHECK
 * constraint, and #392 is what happens without one — an enum twelve values behind the
 * database, across five migrations, every test green.
 *
 * ## Read as text, because it cannot be imported
 *
 * The mirror is Deno source: `npm:` specifiers, its own `deno.json`, outside the pnpm
 * workspace. Vitest cannot import it, which is exactly why the two copies were left to
 * review in the first place. So this reads the file and pulls the keys out of the `TEMPLATES`
 * object literal — the same move the other five `*.mirror.test.ts` files make against SQL and
 * JSON, applied to a third file type. It is a textual match on a literal, so it would miss
 * keys assembled at runtime; nothing in that file does, and the sanity assertion below fails
 * loudly if the literal ever stops being parseable rather than reporting an empty mirror.
 */
/**
 * Found by walking UP, not by counting `../`: Stryker runs the suite from a sandbox copy of
 * the package two levels deeper than the package sits in the repo, where a fixed relative path
 * resolves to `packages/schemas/supabase/...` and kills the dry run. (`reserved-handles.mirror.test.ts`
 * and `audit-log-actions.mirror.test.ts` carry the same note.)
 */
const MIRROR = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'supabase', 'functions', '_shared', 'notif-templates.ts');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error('no supabase/functions/_shared/notif-templates.ts above this test');
    dir = parent;
  }
})();

const SOURCE = readFileSync(MIRROR, 'utf8');

/**
 * `notif.tpl.generic` is the ONE key the mirror is allowed not to carry, and the exemption is
 * not a convenience: `notification.ts` calls it "client-only: the degrade target, never
 * written server-side". Nothing enqueues it, so a server-side template for it would be dead
 * copy in both locales — and the third assertion below pins the degrade path that makes its
 * absence safe, so the exemption cannot outlive its own reason.
 */
const CLIENT_ONLY = ['notif.tpl.generic'] as const;

/** The quoted keys of the `TEMPLATES` object literal, in source order. */
function mirroredKeys(): string[] {
  const start = SOURCE.indexOf('const TEMPLATES');
  if (start === -1) throw new Error('notif-templates.ts declares no TEMPLATES');
  const end = SOURCE.indexOf('\n};', start);
  if (end === -1) throw new Error('the TEMPLATES literal does not close at column 0');
  // Two-space indent: the top level of the literal. A deeper key ('it', 'en', 'title') is
  // indented further and must not be read as a template key.
  return [...SOURCE.slice(start, end).matchAll(/^ {2}'([^']+)':/gm)].map(
    ([, key]) => key as string,
  );
}

describe('notif-templates.ts mirrors NOTIFICATION_TEMPLATE_KEYS', () => {
  const mirrored = mirroredKeys();
  const serverWritten = NOTIFICATION_TEMPLATE_KEYS.filter(
    (k) => !(CLIENT_ONLY as readonly string[]).includes(k),
  );

  it('parses the mirror at all', () => {
    // Without this, a rename or a reformat that broke the regex would empty the list and read
    // exactly like a mirror in perfect sync — the failure this whole file exists to make loud.
    expect(mirrored.length, 'no keys parsed out of the TEMPLATES literal').toBeGreaterThan(10);
  });

  it('carries every server-written template key, in the same order', () => {
    expect(
      mirrored,
      'a push template key the schema declares is missing from the Deno mirror. ' +
        'buildPushMessages returns [] for an unknown key, so the notification row will appear ' +
        'in the app and no push will ever be sent — silently, in both locales.',
    ).toEqual(serverWritten);
  });

  it('carries nothing the schema does not declare', () => {
    expect(
      mirrored.filter((k) => !(NOTIFICATION_TEMPLATE_KEYS as readonly string[]).includes(k)),
      'the Deno mirror composes copy for a key NOTIFICATION_TEMPLATE_KEYS does not list. ' +
        'Nothing can enqueue it, so it is dead copy in two locales — or the schema list is ' +
        'the half that is behind.',
    ).toEqual([]);
  });

  it('the exempt key is exempt because the lookup degrades, not by assertion', () => {
    // The one thing that makes CLIENT_ONLY safe. If the miss ever became a throw, an absent
    // key would stop being "no push" and start being a crashed dispatch for every recipient,
    // and this exemption would have to go — so pin the degrade rather than trust the comment.
    expect(
      SOURCE,
      'buildPushMessages no longer returns [] on an unknown template key — the CLIENT_ONLY ' +
        'exemption above assumed it did.',
    ).toContain('if (!tpl) return [];');
    expect(
      CLIENT_ONLY.filter((k) => !(NOTIFICATION_TEMPLATE_KEYS as readonly string[]).includes(k)),
      'CLIENT_ONLY names a key the schema no longer declares, so it excuses nothing.',
    ).toEqual([]);
  });
});
