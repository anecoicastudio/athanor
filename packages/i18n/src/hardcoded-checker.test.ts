import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/check-i18n-hardcoded.mjs` is the automated half of rule 5, and nothing tested it
 * until #169 — which is how it shipped with a comment masker that blanked the rest of any
 * line containing a url, silently dropping every finding after it.
 *
 * Black-box on purpose: CI runs the CLI, so the CLI is the contract. The script takes its
 * roots as arguments precisely so a fixture tree can stand in for `apps/`.
 *
 * Found by walking UP rather than counting `../`, the same trap `audit-log-actions.mirror.test.ts`
 * documents: a test runner may execute the suite from a sandbox copy of the package.
 */
const CHECKER = (() => {
  let dir = fileURLToPath(new URL('.', import.meta.url).href);
  for (;;) {
    const candidate = join(dir, 'scripts', 'check-i18n-hardcoded.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no scripts/check-i18n-hardcoded.mjs above this test');
    dir = parent;
  }
})();

/** Write `files` into a throwaway tree, scan it, and return the checker's own output. */
function scan(files: Record<string, string>): { ok: boolean; report: string } {
  const root = mkdtempSync(join(tmpdir(), 'i18n-check-'));
  for (const [name, body] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body, 'utf8');
  }
  try {
    return {
      ok: true,
      report: execFileSync(process.execPath, [CHECKER, root], { encoding: 'utf8' }),
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, report: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('hardcoded-string checker', () => {
  it('passes a tree whose copy all goes through t()', () => {
    const { ok, report } = scan({
      'clean.tsx': `export const Card = () => <Text>{t('carta.titolo')}</Text>;\n`,
    });
    expect(ok).toBe(true);
    expect(report).toContain('i18n:check OK');
  });

  it('flags copy that follows a url on the same line (#169)', () => {
    // The reproduction case: `//` inside a single-quoted string used to open a line comment,
    // blanking `label` and everything else after it.
    const { ok, report } = scan({
      'link.tsx': `const url = 'https://x.com/a';\nexport const Go = () => <Link href='https://x.com/a' label='Vai avanti' />;\n`,
    });
    expect(ok).toBe(false);
    expect(report).toContain('Vai avanti');
  });

  it('does not let an apostrophe in JSX text unmask the rest of its line', () => {
    // `dell'evento` must stay prose. If it opened a string, the `//` after it would be inside
    // that string, the comment would never be masked, and its markup would be read as live copy.
    const { ok, report } = scan({
      'apostrophe.tsx':
        `export const Intro = () => <Text>{t('intro.titolo')} dell'evento</Text>; ` +
        `// <Text>Testo commentato che non va segnalato</Text>\n`,
    });
    expect(report).not.toContain('Testo commentato');
    expect(ok).toBe(true);
  });

  it('bounds an unterminated quote to its own line', () => {
    // `Nel '900` opens a quote that never closes (the `'` follows `>`, not a letter). It is a
    // real finding on that line; the newline ends the string state so the next line's comment
    // is still masked.
    const { ok, report } = scan({
      'stray-quote.tsx': [
        `export const Storia = () => <Text>Nel '900 tutto cambiò</Text>;`,
        `// <Text>Testo commentato che non va segnalato</Text>`,
        ``,
      ].join('\n'),
    });
    expect(ok).toBe(false);
    expect(report).toContain("Nel '900 tutto cambiò");
    expect(report).not.toContain('Testo commentato');
  });

  it('scans every root it is given', () => {
    const root = mkdtempSync(join(tmpdir(), 'i18n-check-'));
    for (const app of ['uno', 'due']) {
      mkdirSync(join(root, app), { recursive: true });
      writeFileSync(
        join(root, app, 'screen.tsx'),
        `export const S = () => <Text>Copia di ${app} non tradotta</Text>;\n`,
        'utf8',
      );
    }
    let report = '';
    try {
      execFileSync(process.execPath, [CHECKER, join(root, 'uno'), join(root, 'due')], {
        encoding: 'utf8',
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      report = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(report).toContain('Copia di uno non tradotta');
    expect(report).toContain('Copia di due non tradotta');
  });
});
