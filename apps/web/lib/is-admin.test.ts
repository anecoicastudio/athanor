import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { isAdmin } from './is-admin';

const userWith = (meta: Partial<Pick<User, 'app_metadata' | 'user_metadata'>>) =>
  ({ app_metadata: {}, user_metadata: {}, ...meta }) as User;

describe('isAdmin', () => {
  it('admits a user whose app_metadata.role is admin', () => {
    expect(isAdmin(userWith({ app_metadata: { role: 'admin' } }))).toBe(true);
  });

  it('IGNORES user_metadata.role — it is self-writable, so trusting it would make admin self-grantable', () => {
    expect(isAdmin(userWith({ user_metadata: { role: 'admin' } }))).toBe(false);
  });

  it('does not admit an unrelated role', () => {
    expect(isAdmin(userWith({ app_metadata: { role: 'moderator' } }))).toBe(false);
  });

  it('does not admit a user with no role at all', () => {
    expect(isAdmin(userWith({}))).toBe(false);
  });

  it('does not admit an anonymous visitor', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('requires an exact match, not a prefix or different case', () => {
    expect(isAdmin(userWith({ app_metadata: { role: 'Admin' } }))).toBe(false);
    expect(isAdmin(userWith({ app_metadata: { role: 'administrator' } }))).toBe(false);
  });
});

/**
 * #62: `isAdmin` is the ONLY implementation of the admin rule. Two routes used to inline the
 * same predicate; an authorization check that exists in several copies is the one whose next
 * change misses a copy. So scan the app's source for any other read of `app_metadata` — the
 * claim the rule is made of — the way apps/native/src/lib/source-audit.test.ts pins its
 * invariants. Comment lines are skipped (prose may name the claim), test files too.
 *
 * `.href` (a string), not the URL object — same idiom as tokens-mirror.test.ts.
 */
const WEB = fileURLToPath(new URL('..', import.meta.url).href);
const RULE_HOME = `${WEB}lib/is-admin.ts`;
const SCANNED_DIRS = ['app/', 'components/', 'lib/', 'utils/'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}${name}`;
    if (statSync(p).isDirectory()) walk(`${p}/`, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);

describe('isAdmin is the only admin rule in apps/web (#62)', () => {
  it('no other source file reads app_metadata', () => {
    const offenders: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of walk(`${WEB}${dir}`)) {
        if (file === RULE_HOME || /\.test\.tsx?$/.test(file)) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!isComment(line) && /\bapp_metadata\b/.test(line)) {
              offenders.push(`${file.slice(WEB.length)}:${i + 1}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still finds the rule where it lives — so the scan is known to see code', () => {
    expect(readFileSync(RULE_HOME, 'utf8')).toMatch(/\bapp_metadata\b/);
  });
});
