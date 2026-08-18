// scripts/check-i18n-hardcoded.mjs
// Hardcoded-string gate (frontend 10 §3.1 I-2), CLAUDE.md rule 5.
// Flags natural-language literals under DEFAULT_ROOTS (both apps) that are NOT wrapped in t().
// Allowlist a line with an `i18n-ignore` comment (any style), or add a brand token
// to ALLOWLIST.
//
// Still a FLOOR, not a wall — it is regex over comment-masked source, not an AST pass —
// but a wider one than the original single-line `.tsx` scan. It now sees:
//   * `.ts` as well as `.tsx`  (key selection increasingly lives in plain modules)
//   * MULTI-LINE JSX text      (Prettier routinely splits <Text> children onto own lines)
//   * template-literal JSX children
//   * Alert.alert(...) titles, bodies, and button `text:` labels
//   * a widened text-prop set, matched by NAME SUFFIX rather than a fixed list of six
//
// Six shapes it still cannot see — object-literal copy, function arguments other than
// Alert.alert, ternaries, JSX children mixing text and expressions, short strings, and a
// constant assigned then rendered — are tracked with reproductions in #433. Each is its own
// pass; `packages/i18n/src/hardcoded-checker.test.ts` is the harness they land against.
//
// Deliberately NOT flagged, and these are the load-bearing exclusions:
//   * `throw new Error('...')` — developer-facing, intentionally English (supabase.ts,
//     supabase-key.ts). Never rendered.
//   * `*.test.ts(x)` — fixtures, not user-facing copy.
//   * anything already inside t(...), including `${t(...)}` inside a template literal.
//   * enum-ish prop values (accessibilityRole="button", variant="ghost", style: 'cancel')
//     — reached only through the suffix list and the Alert arg positions, never blanket.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Trees scanned by default. `apps/web` joined `apps/native` in #169 — it was never scanned,
 * while 44 of its files import `@athanor/i18n`, so rule 5 was enforced on one app of two.
 * Its directories are listed one by one rather than walking `apps/web` whole: the app also
 * holds `.next`, `.open-next` and `.wrangler` build output, and `e2e/`, whose literals are
 * playwright fixtures rather than shipped copy.
 *
 * `packages/*` is deliberately absent — no `.tsx` lives there and every pass below is JSX-,
 * prop- or `Alert.alert`-shaped, so it would be dead scope.
 *
 * A root that stops existing throws ENOENT from `walk`, which is the loud failure a silently
 * narrowed scan would not be. Override by passing roots as arguments — used by the test that
 * pins this file's behaviour against fixtures, never by CI.
 */
const DEFAULT_ROOTS = [
  'apps/native/src',
  'apps/web/app',
  'apps/web/components',
  'apps/web/lib',
  'apps/web/utils',
];
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;

/**
 * Text-bearing prop names. Suffix-matched (case-insensitive on the final word) so component
 * props like `backLabel`, `emptyCta`, `descPlaceholder`, `venuePlaceholder` are covered
 * without listing all ~70 of them. `name`/`variant`/`tone`/`status`/`field` are deliberately
 * absent: their values are identifiers and enum members, not copy.
 */
const TEXT_PROP_SUFFIX =
  /(?:^|[a-z0-9])(label|title|text|message|placeholder|hint|cta|caption|subtitle|heading|description|body)$/i;
/**
 * Names that DO end in a text suffix but never carry copy. Both hold non-strings today, so
 * neither can reach the literal/template branches — they are here so that adding a string
 * form later is a conscious decision rather than a surprise CI failure.
 */
const PROP_EXCEPTIONS = new Set([
  'onChangeText', // handler
  'tabBarShowLabel', // boolean
]);

// Intentional non-translatable literals. Empty today — the «✦ Aura 0» chip
// moved behind `momenti.aura.chip` (#52). Adding an entry is a conscious
// exception, not a shortcut past rule #5.
const ALLOWLIST = new Set([]);

// prose heuristic: has a letter, and either a space or a >=4-char lowercase run
const looksLikeProse = (s) => /[A-Za-zÀ-ÿ]/.test(s) && (/\s/.test(s) || /[a-zà-ÿ]{4,}/.test(s));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) yield p;
  }
}

/** A `'` preceded by one of these is an apostrophe in prose (`l'evento`, `un po'`), not a quote. */
const WORD_CHAR = /[A-Za-z0-9\u00C0-\u024F]/;

/**
 * Blank out `//` and block comments, preserving every offset and newline so line numbers
 * stay exact. Naive about regex literals containing `//` or `/*`: worst case it masks a bit
 * too much, which LOSES a finding rather than inventing one — the right way for a floor to
 * be wrong. Strings are preserved (the prop and Alert passes need their contents).
 *
 * All three quote characters open a string, so a `//` inside one — i.e. ANY url — no longer
 * blanks the rest of its line and takes real findings with it (#169). `'` needs two guards to
 * be safe, because Italian copy is full of apostrophes:
 *   * it opens a string only when the preceding character is not a word character, so the
 *     apostrophe in `l'evento` or `un po'` stays what it is;
 *   * a `'` or `"` string ends at the newline regardless. A quote that never closes on its own
 *     line was not a string literal (only a backtick may span lines), and bounding it there
 *     keeps a stray apostrophe from swallowing comment masking for the rest of the file.
 * Both guards fail toward masking more, which loses a finding rather than inventing one.
 */
function maskComments(src) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === quote || (c === '\n' && quote !== '`')) quote = '';
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === '`' || (c === "'" && !WORD_CHAR.test(src[i - 1] ?? ''))) {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** offset -> 1-based line number. */
function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Text of the balanced `(...)` starting at `open` (the index of the paren). */
function balanced(src, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Blank out every `t(...)` call so only untranslated literals remain. */
function stripTCalls(text) {
  let out = text;
  for (;;) {
    const m = /\bt\s*\(/.exec(out);
    if (!m) return out;
    const inner = balanced(out, m.index + m[0].length - 1);
    const whole = out.slice(m.index, m.index + m[0].length + inner.length + 1);
    out = out.slice(0, m.index) + whole.replace(/[^\n]/g, ' ') + out.slice(m.index + whole.length);
  }
}

/** Split on top-level commas (ignoring nesting and strings). */
function topLevelArgs(text) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const violations = [];
for (const file of ROOTS.flatMap((root) => [...walk(root)])) {
  const raw = readFileSync(file, 'utf8');
  const src = maskComments(raw);
  const rawLines = raw.split('\n');
  const lineOf = lineIndex(src);
  /** `i18n-ignore` anywhere in the match's own lines, or on the line above it. */
  const ignored = (from, to) => {
    const a = Math.max(1, lineOf(from) - 1);
    const b = lineOf(to);
    return rawLines.slice(a - 1, b).some((l) => l.includes('i18n-ignore'));
  };
  const add = (from, to, what) => {
    if (!ignored(from, to)) violations.push([file, lineOf(from), what]);
  };

  // --- 1. JSX text nodes, single- AND multi-line -----------------------------------------
  // `>text</` with the closing-tag slash required, so TS generics (`=> Promise<void>`) and
  // comparisons (`index < n`) are not matched. Newlines are allowed inside the run now;
  // `<`, `{`, `}` are not, so the match can only ever be one direct text child.
  for (const m of src.matchAll(/>([^<>{}]+)<\//g)) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    // `=`/`;` never appear in this app's copy but do appear in stray code runs — cheap
    // insurance that keeps the gate a floor.
    if (/[=;]/.test(text)) continue;
    if (looksLikeProse(text) && !ALLOWLIST.has(text)) add(m.index, m.index + m[0].length, text);
  }

  // --- 2. template-literal JSX children: `>{`…`}</` ---------------------------------------
  for (const m of src.matchAll(/>\s*\{\s*`([^`]*)`\s*\}\s*<\//g)) {
    const text = m[1];
    if (text.includes('${t(')) continue; // interpolated translation
    const literal = text
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (looksLikeProse(literal) && !ALLOWLIST.has(literal))
      add(m.index, m.index + m[0].length, `\`${literal}\``);
  }

  // --- 3. text-bearing props --------------------------------------------------------------
  // string literal, `{'literal'}`, or a template literal with no t() inside.
  const propRe =
    /\b([a-zA-Z][a-zA-Z0-9_]*)=(?:(["'])((?:[^"'\\\n]|\\.)*?)\2|\{\s*(["'])((?:[^"'\\\n]|\\.)*?)\4\s*\}|\{\s*`([^`]*)`\s*\})/g;
  for (const m of src.matchAll(propRe)) {
    const prop = m[1];
    if (PROP_EXCEPTIONS.has(prop) || !TEXT_PROP_SUFFIX.test(prop)) continue;
    const tpl = m[6];
    if (tpl !== undefined && tpl.includes('${t(')) continue;
    const value = (m[3] ?? m[5] ?? tpl ?? '').replace(/\$\{[^}]*\}/g, ' ').trim();
    if (looksLikeProse(value) && !ALLOWLIST.has(value))
      add(m.index, m.index + m[0].length, `${prop}="${value}"`);
  }

  // --- 4. Alert.alert(...) ----------------------------------------------------------------
  // Its strings are as user-facing as any <Text>, and the original gate could not see them
  // at all. Only the two positional message args and button `text:` labels are inspected —
  // `style: 'cancel' | 'destructive'` are enum values, not copy, and must not be flagged.
  for (const m of src.matchAll(/\bAlert\s*\.\s*alert\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const args = stripTCalls(balanced(src, open));
    const parts = topLevelArgs(args);
    const candidates = [];
    for (const part of parts.slice(0, 2))
      for (const lit of part.matchAll(/(["'`])((?:[^"'`\\]|\\.)*?)\1/g)) candidates.push(lit[2]);
    for (const lit of args.matchAll(/\btext:\s*(["'`])((?:[^"'`\\]|\\.)*?)\1/g))
      candidates.push(lit[2]);
    for (const c of candidates) {
      const value = c.replace(/\$\{[^}]*\}/g, ' ').trim();
      if (looksLikeProse(value) && !ALLOWLIST.has(value))
        add(open, open + args.length, `Alert.alert(… "${value}" …)`);
    }
  }
}

if (violations.length) {
  console.error(
    'Hardcoded user-facing strings (wrap in t(), add an i18n-ignore comment, or extend ALLOWLIST):',
  );
  for (const [f, ln, txt] of violations) console.error(`  ${f}:${ln}  ${txt}`);
  process.exit(1);
}
console.log('i18n:check OK — no hardcoded user-facing strings.');
