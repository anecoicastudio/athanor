import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('scans both apps by default (#169)', () => {
    // The scan is black-box everywhere else, but the DEFAULT roots are exactly what #169 was
    // about — `apps/web` went unscanned for its whole life while 44 of its files import the
    // catalog. Read off the source so a silent narrowing back to one app fails here. A root
    // that stops existing needs no assertion: `walk` throws ENOENT and CI goes red.
    const defaults = /const DEFAULT_ROOTS = \[([^\]]*)\]/.exec(readFileSync(CHECKER, 'utf8'));
    const roots = [...(defaults?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(roots).toContain('apps/native/src');
    expect(roots.some((r) => r?.startsWith('apps/web/'))).toBe(true);
  });

  // --- #433: the six structural blind spots ------------------------------------------------
  // Each fixture is the reproduction from the issue body, verbatim. Every one of them exited 0
  // against the regex checker; the AST rewrite is what makes them red.

  it('flags copy under a text-bearing key in an object literal (#433 a)', () => {
    const { ok, report } = scan({
      'a-object.tsx': `const options = [{ label: 'Vicino a me', value: 'near' }];\n`,
    });
    expect(ok).toBe(false);
    expect(report).toContain('Vicino a me');
  });

  it('flags copy passed to a call other than Alert.alert (#433 b)', () => {
    const { ok, report } = scan({
      'b-call.tsx': [
        `showToast('Non è stato possibile salvare');`,
        `setError('Riprova tra qualche istante');`,
        ``,
      ].join('\n'),
    });
    expect(ok).toBe(false);
    expect(report).toContain('Non è stato possibile salvare');
    expect(report).toContain('Riprova tra qualche istante');
  });

  it('flags both arms of a ternary in a text prop (#433 c)', () => {
    const { ok, report } = scan({
      'c-ternary.tsx': `export const B = () => <Btn label={on ? 'Attiva' : 'Disattiva ora'} />;\n`,
    });
    expect(ok).toBe(false);
    expect(report).toContain('Attiva');
    expect(report).toContain('Disattiva ora');
  });

  it('flags a JSX text run that sits beside an expression (#433 d)', () => {
    const { ok, report } = scan({
      'd-mixed.tsx': `export const S = () => <Text>Ciao {name}, come stai oggi</Text>;\n`,
    });
    expect(ok).toBe(false);
    expect(report).toContain('come stai oggi');
  });

  it('flags a module-scope const that is rendered, at its declaration (#433 f)', () => {
    // Moving the literal to a const is the first thing a developer reaches for when the gate
    // complains, and it used to silence it. The report must point at the declaration — line 1 —
    // because that is where the t() call goes, not at the JSX that reads it.
    const { ok, report } = scan({
      'f-const.tsx': [
        `const TITLE = 'Il tuo Momento ti aspetta';`,
        `export const S = () => <Text>{TITLE}</Text>;`,
        ``,
      ].join('\n'),
    });
    expect(ok).toBe(false);
    expect(report).toContain('Il tuo Momento ti aspetta');
    expect(report).toMatch(/f-const\.tsx:1\b/);
  });

  it('leaves a const alone until something renders it (#433 f)', () => {
    const { ok } = scan({
      'f-unused.tsx': [
        `const TITLE = 'Il tuo Momento ti aspetta';`,
        `export const id = (x: string) => x + TITLE.length;`,
        ``,
      ].join('\n'),
    });
    expect(ok).toBe(true);
  });

  it('flags short single-word copy but not acronyms (#433 e)', () => {
    const { ok, report } = scan({
      'e-short.tsx': `export const S = () => <><Text>Ciao</Text><Text>Esci</Text></>;\n`,
      'e-acronyms.tsx': `export const A = () => <><Text>OK</Text><Text>ID</Text><Text>PDF</Text></>;\n`,
    });
    expect(ok).toBe(false);
    expect(report).toContain('Ciao');
    expect(report).toContain('Esci');
    expect(report).not.toContain('e-acronyms');
  });

  // --- the exclusions the widened passes are most likely to break ----------------------------

  it('does not flag enum-ish values reached by the widened object pass', () => {
    // `style: 'cancel'` is the canonical one, and it now sits in the same shape as case (a).
    // `text: 'text-on-aura'` is a Tailwind class under a text-suffixed key; `label:` holding an
    // i18n key is what half of apps/web's section list looks like.
    const { ok, report } = scan({
      'enums.tsx': [
        `const dialog = { style: 'cancel', variant: 'ghost', mode: 'date' };`,
        `const classes = { light: { bg: 'bg-aura', text: 'text-on-aura' } };`,
        `const sections = [{ id: 'manifesto', label: 'landing.manifesto.eyebrow' }];`,
        ``,
      ].join('\n'),
    });
    expect(report).not.toContain('cancel');
    expect(report).not.toContain('text-on-aura');
    expect(report).not.toContain('landing.manifesto.eyebrow');
    expect(ok).toBe(true);
  });

  it('still reads Alert.alert titles, bodies and button labels', () => {
    // The one call the old gate did see. `style:` sits in the same object as `text:` and must
    // stay out; the labels must stay in, which is why the object pass rejects CODE-shaped
    // values rather than single words.
    const { ok, report } = scan({
      'alert.tsx': [
        `export const ask = () =>`,
        `  Alert.alert('Vuoi uscire?', 'Perderai le modifiche', [`,
        `    { text: 'Annulla', style: 'cancel' },`,
        `    { text: 'Esci', style: 'destructive' },`,
        `  ]);`,
        ``,
      ].join('\n'),
    });
    expect(ok).toBe(false);
    expect(report).toContain('Vuoi uscire?');
    expect(report).toContain('Perderai le modifiche');
    expect(report).toContain('Annulla');
    expect(report).not.toContain('destructive');
  });

  it('does not flag developer-facing throws or console output', () => {
    const { ok, report } = scan({
      'throws.ts': [
        `export const key = (v?: string) => {`,
        `  if (!v) throw new Error('Missing Supabase publishable key');`,
        `  console.warn('falling back to the legacy anon key');`,
        `  return v;`,
        `};`,
        ``,
      ].join('\n'),
    });
    expect(report).not.toContain('Missing Supabase');
    expect(report).not.toContain('legacy anon key');
    expect(ok).toBe(true);
  });

  it('does not flag Supabase identifiers or Tailwind class lists in call arguments', () => {
    // The reason the call-argument pass uses a stricter predicate than the JSX passes: position
    // proves copy inside JSX and proves nothing at all in an argument list.
    const { ok, report } = scan({
      'queries.ts': [
        `export const load = () =>`,
        `  supabase.from('momento_proposals').select('id, created_at').eq('profile_id', id);`,
        `export const cls = cn('rounded-full border border-hair bg-raise px-5 py-4');`,
        `export const mq = () => matchMedia('(prefers-reduced-motion: reduce)');`,
        `export const log = () => devWarn('[profile] dream load', e);`,
        ``,
      ].join('\n'),
    });
    expect(report).not.toContain('created_at');
    expect(report).not.toContain('border-hair');
    expect(report).not.toContain('prefers-reduced-motion');
    expect(report).not.toContain('dream load');
    expect(ok).toBe(true);
  });

  it('honours i18n-ignore on the match line and i18n-ignore-file on the file', () => {
    const { ok, report } = scan({
      'ignored.tsx': `export const S = () => <Text>Copia non tradotta</Text>; // i18n-ignore\n`,
      'whole.ts': [
        `// i18n-ignore-file — this module is its own per-locale content source.`,
        `export const doc = { title: 'Informativa sulla privacy' };`,
        ``,
      ].join('\n'),
    });
    expect(report).not.toContain('Copia non tradotta');
    expect(report).not.toContain('Informativa sulla privacy');
    expect(ok).toBe(true);
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
