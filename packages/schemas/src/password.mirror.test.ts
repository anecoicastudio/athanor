import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, unmetPasswordRequirements } from './password.ts';

/**
 * `password.ts` says it mirrors `supabase/config.toml [auth]`, and until this file
 * nothing enforced that — the same shape of claim that `apps/native/src/lib/
 * tokens-mirror.test.ts` exists to close for `global.css`.
 *
 * The stake here is a form that goes green on a password the server then refuses:
 * the client decides what to render, GoTrue decides what to accept, and a one-file
 * edit leaves every other test passing while signup breaks for real people.
 *
 * The hosted project holds a THIRD copy of these two settings (Authentication →
 * Sign In / Providers → Email) which no test can reach. `config.toml` governs only
 * a local `supabase start` stack, so a green run here is necessary, not sufficient
 * — see docs/RELEASE-RUNBOOK.md B-9.
 */
const CONFIG = readFileSync(
  fileURLToPath(new URL('../../../supabase/config.toml', import.meta.url).href),
  'utf8',
);

/** Read a bare `key = value` out of the toml, ignoring commented-out lines. */
function setting(key: string): string | undefined {
  return CONFIG.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim();
}

describe('the password policy mirrors supabase/config.toml', () => {
  it('minimum_password_length === PASSWORD_MIN_LENGTH', () => {
    const declared = setting('minimum_password_length');
    expect(declared, 'minimum_password_length missing from config.toml').toBeDefined();
    expect(Number(declared)).toBe(PASSWORD_MIN_LENGTH);
  });

  it('password_requirements is the preset these rules implement', () => {
    // GoTrue's `lower_upper_letters_digits` checks membership in the literal
    // a-z / A-Z / 0-9 sets — which is why the rules are ASCII and not \p{Ll}.
    expect(setting('password_requirements')).toBe('"lower_upper_letters_digits"');
  });

  it('a password meeting our rules meets the preset, class for class', () => {
    // Each class dropped in turn must be the ONLY thing our checker complains
    // about, so the mapping to the preset's three classes stays one-to-one.
    expect(unmetPasswordRequirements('Abcdefg1')).toEqual([]);
    expect(unmetPasswordRequirements('ABCDEFG1')).toEqual(['lowercase']);
    expect(unmetPasswordRequirements('abcdefg1')).toEqual(['uppercase']);
    expect(unmetPasswordRequirements('Abcdefgh')).toEqual(['digit']);
    // The preset must NOT require symbols — that would be the `..._symbols` one.
    expect(unmetPasswordRequirements('Abcdefg1')).toEqual([]);
  });
});
