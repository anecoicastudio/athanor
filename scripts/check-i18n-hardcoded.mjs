// scripts/check-i18n-hardcoded.mjs
// Conservative hardcoded-string gate (frontend 10 §3.1 I-2).
// Flags natural-language literals in JSX text nodes and known text props
// under apps/mobile/src that are NOT wrapped in t(). Allowlist a line with
// an `i18n-ignore` comment (any style), or add a brand token to ALLOWLIST.
// FLOOR, not a ceiling: a deliberately conservative single-line regex gate.
// It does NOT catch multi-line JSX text, template-literal JSX text, or
// imperative-API strings (Alert.alert(...), thrown messages). Those rely on
// review + the parity test; replace with an AST pass if coverage must grow.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/mobile/src';
const TEXT_PROPS = [
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'title',
  'label',
  'message',
];
// Intentional non-translatable literals: glyph + the score's proper name + a
// dormant-engine placeholder. "Aura" is never localized (CLAUDE.md: the score
// name stays "Aura" in both IT and EN).
const ALLOWLIST = new Set(['✦ Aura 0']);
// prose heuristic: has a letter, and either a space or a >=4-char lowercase run
const looksLikeProse = (s) => /[A-Za-zÀ-ÿ]/.test(s) && (/\s/.test(s) || /[a-zà-ÿ]{4,}/.test(s));
const isComment = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.tsx')) yield p; // JSX text nodes only live in .tsx
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('i18n-ignore') || isComment(line)) return;
    // JSX text node: `>text</` — require the closing-tag slash so TS generics
    // (`=> Promise<void>`) and comparisons (`index < n`) are not matched.
    for (const m of line.matchAll(/>([^<>{}\n]+)<\//g)) {
      const text = m[1].trim();
      if (looksLikeProse(text) && !ALLOWLIST.has(text)) violations.push([file, i + 1, text]);
    }
    // text-bearing props with a string-literal value
    for (const prop of TEXT_PROPS) {
      const re = new RegExp(`\\b${prop}=(["'])([^"']*?)\\1`, 'g');
      for (const m of line.matchAll(re)) {
        if (looksLikeProse(m[2]) && !ALLOWLIST.has(m[2]))
          violations.push([file, i + 1, `${prop}="${m[2]}"`]);
      }
    }
  });
}

if (violations.length) {
  console.error(
    'Hardcoded user-facing strings (wrap in t(), add an i18n-ignore comment, or extend ALLOWLIST):',
  );
  for (const [f, ln, txt] of violations) console.error(`  ${f}:${ln}  ${txt}`);
  process.exit(1);
}
console.log('i18n:check OK — no hardcoded user-facing strings.');
