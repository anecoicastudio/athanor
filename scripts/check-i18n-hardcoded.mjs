// scripts/check-i18n-hardcoded.mjs
// Hardcoded-string gate (frontend 10 §3.1 I-2), CLAUDE.md rule 5.
// Flags natural-language literals under DEFAULT_ROOTS (both apps) that are NOT wrapped in t().
// Allowlist a line with an `i18n-ignore` comment (any style), a whole file with an
// `i18n-ignore-file` comment, or add a brand token to ALLOWLIST. Both are read off comment
// tokens, so a string literal that happens to contain the word cannot switch the gate off.
//
// The whole-file form is PINNED to EXEMPT_FILES since #443. It switches rule 5 off for an
// entire file and is invisible in every later diff to that file, so the set of files allowed to
// carry it is declared here by name: an unlisted file carrying it fails, and a listed file that
// no longer carries it fails too. Growing the set is then a reviewable line rather than a
// comment nobody sees again.
//
// A TypeScript-AST pass since #433, not regex over comment-masked source. The masker it
// replaced existed only because a regex cannot tell a comment from a string; the parser can,
// so that whole class of bug is gone, and «is this literal in copy position?» is a question
// about the tree rather than about what characters happen to sit either side of it.
//
// What it sees:
//   * JSX text children, including a text run that sits beside `{…}` expressions
//   * JSX expression children — literals, template literals, and BOTH arms of a ternary
//   * text-bearing props (matched by NAME SUFFIX), including expression-valued ones
//   * text-bearing keys in object literals (`{ label: 'Vicino a me' }`)
//   * arguments to any call, under a stricter copy predicate (see `looksLikeCopyArgument`)
//   * `Alert.alert(...)` titles, bodies, and button `text:` labels
//   * a module-scope `const` holding copy that is then rendered — reported at the DECLARATION
//   * short single-word copy (`<Text>Ciao</Text>`), which a 4-character lowercase run missed
//
// Deliberately NOT flagged, and these are the load-bearing exclusions:
//   * `throw new Error('...')` and `new SomeError('...')` — developer-facing, intentionally
//     English (supabase.ts, supabase-key.ts). Never rendered. `console.*` likewise.
//   * `*.test.ts(x)` — fixtures, not user-facing copy.
//   * anything already inside t(...), including `${t(...)}` inside a template literal.
//   * enum-ish values (`accessibilityRole="button"`, `variant="ghost"`, `style: 'cancel'`)
//     — reached only through the suffix list and the Alert arg positions, never blanket.
//   * i18n keys themselves (`label="tag.identity"`, `{ title: 'fund.disclose.where.title' }`).
//   * code-shaped object values (`{ text: 'text-on-aura' }` — a Tailwind class, not copy).
//
// Still a FLOOR, and where it stops is written down: `looksLikeProse` says what a two-character
// word costs, `looksLikeCopyArgument` says why a call argument is judged more strictly than a
// JSX child, and `textLiterals` says why the walk stops at calls and at nested JSX.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Trees scanned by default. `apps/web` joined `apps/native` in #169 — it was never scanned,
 * while 44 of its files import `@athanor/i18n`, so rule 5 was enforced on one app of two.
 * Its directories are listed one by one rather than walking `apps/web` whole: the app also
 * holds `.next`, `.open-next` and `.wrangler` build output, and `e2e/`, whose literals are
 * playwright fixtures rather than shipped copy.
 *
 * `packages/*` is deliberately absent — no `.tsx` lives there and the JSX passes would be dead
 * scope. The object-literal and call-argument passes would not be, but `packages/i18n` IS the
 * catalog and `packages/core` is pure domain logic, so the copy that matters is in the apps.
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
 * Roots the EXEMPT_FILES guard has anything to say about: the ones it knows by name.
 *
 * `EXEMPT_FILES` is a claim about THIS repo's trees, so it can only be judged against those
 * trees. Pointing the checker at an arbitrary directory — which is exactly what the test
 * harness does, and the only other way this script is ever invoked — says nothing about whether
 * `apps/web/lib/legal-content.ts` is still exempt, and must not be read as saying it.
 *
 * It is also what keeps the guard's path matching strict. Every guarded path is
 * `join(<a DEFAULT_ROOTS entry>, …)` and therefore repo-relative in the same shape the list is
 * written in, so `EXEMPT_FILES` is compared by EQUALITY. A suffix match would have been the
 * other way to survive an absolute tmpdir root, and it would have let any file whose path
 * happens to end in a listed one inherit the exemption.
 */
const GUARDED_ROOTS = ROOTS.filter((root) => DEFAULT_ROOTS.includes(root));
const guarded = (p) => GUARDED_ROOTS.some((root) => p === root || p.startsWith(`${root}/`));

/**
 * Text-bearing prop and object-key names. Suffix-matched (case-insensitive on the final word)
 * so component props like `backLabel`, `emptyCta`, `descPlaceholder`, `venuePlaceholder` are
 * covered without listing all ~70 of them. `name`/`variant`/`tone`/`status`/`field` are
 * deliberately absent: their values are identifiers and enum members, not copy.
 */
const TEXT_PROP_SUFFIX =
  /(?:^|[a-z0-9])(label|title|text|message|placeholder|hint|cta|caption|subtitle|heading|description|body)$/i;
/**
 * Names that DO end in a text suffix but never carry copy.
 * `onChangeText` is a handler and `tabBarShowLabel` a boolean — both hold non-strings today, so
 * neither can reach the literal branches; they are here so that adding a string form later is a
 * conscious decision rather than a surprise CI failure. `context` and `@context` are the suffix
 * rule misfiring — `…ntext` ends in `text` — and carry JSON-LD's `https://schema.org`.
 */
const PROP_EXCEPTIONS = new Set([
  'onChangeText', // handler
  'tabBarShowLabel', // boolean
  'context', // suffix accident: `con|text`
  '@context', // JSON-LD, same accident
]);

// Intentional non-translatable literals. Empty today — the «✦ Aura 0» chip
// moved behind `momenti.aura.chip` (#52). Adding an entry is a conscious
// exception, not a shortcut past rule #5.
const ALLOWLIST = new Set([]);

/**
 * The files permitted to carry `i18n-ignore-file`, repo-relative, one per genuine reason.
 *
 * `legal-content.ts` IS the translation source for the presentation site's two legal documents:
 * every export is a `Record<Locale, …>`, so IT/EN parity is enforced by the type rather than by
 * the catalog, and rule 5's object-literal pass would otherwise report every heading in it.
 *
 * A second entry needs the same kind of answer — «this module is itself a per-locale source» —
 * and not «the gate is noisy here». If the copy is UI copy, it belongs in `@athanor/i18n`; if
 * one line is the problem, `i18n-ignore` on that line is the smaller instrument.
 */
const EXEMPT_FILES = new Set(['apps/web/lib/legal-content.ts']);

/**
 * Prose heuristic for the positions where POSITION ALREADY PROVES COPY — JSX text, JSX
 * expression children, text-bearing props. Has a letter, and either a space or a run of
 * lowercase letters.
 *
 * The run was 4 characters, which is what made `<Text>Ciao</Text>` and `<Text>Esci</Text>`
 * invisible (#433 e). Two is the defensible floor: it is roughly a syllable, and it is what
 * separates a word from the acronyms the loosening was feared for — `OK`, `ID`, `PDF` and
 * `A T H A N O R` carry no lowercase run at all and stay excluded by construction rather than
 * by a hand-kept dictionary. Measured against both apps, dropping 4 to 2 added zero findings.
 *
 * What stays below the floor is a two-character word with a single lowercase letter — `Sì`,
 * `Su`. Nothing structural separates those from `px` or a locale code, so they are left to
 * review rather than bought with an allowlist.
 */
const looksLikeProse = (s) => /[A-Za-zÀ-ÿ]/.test(s) && (/\s/.test(s) || /[a-zà-ÿ]{2,}/.test(s));

/** `tag.identity`, `fund.disclose.where.title` — a key on its way to t(), never copy. */
const I18N_KEY = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;
/**
 * `text-on-aura`, `created_at`, `https://schema.org` — a single token punctuated the way code is.
 * A trailing `.` does not count, so `title: 'Ciao.'` stays copy.
 */
const codeShaped = (s) => !/\s/.test(s) && /[_:/\\-]|\.\S/.test(s);

/**
 * A whitespace-separated token that could occur in a sentence: letters/digits with optional
 * wrapping punctuation, or punctuation alone (an em dash between clauses). Internal hyphens
 * and underscores are deliberately NOT allowed — `rounded-full` and `created_at` are the two
 * shapes that flood this position — and neither are square brackets, which is what makes a
 * `devWarn('[circle] startCheckout', e)` scope tag read as code rather than as a first word.
 */
const PROSE_TOKEN = /^[«»“”"'(]*[A-Za-zÀ-ÿ0-9'’]+[.,!?;:…)"'»”]*$/;
const PUNCT_TOKEN = /^[—–…•·|:;,.!?"'«»“”()-]+$/;
/**
 * Copy predicate for CALL ARGUMENTS. Position proves nothing here: every Supabase table and
 * column name, every Tailwind class list, every router path and every `devWarn('[scope] …')`
 * is a call argument, and `looksLikeProse` accepts all of them. So the argument pass asks for
 * an actual sentence — every token prose-shaped, at least two of them words. It misses
 * `showToast('Salvato')`; it does not cost CI a false failure on `cn(…)` or `select(…)`.
 */
const looksLikeCopyArgument = (s) => {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  let words = 0;
  for (const tok of tokens) {
    if (PROSE_TOKEN.test(tok)) words += 1;
    else if (!PUNCT_TOKEN.test(tok)) return false;
  }
  return words >= 2;
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) yield p;
  }
}

/** `t(...)` / `i18n.t(...)`: everything inside one is already translated. */
const isTCall = (n) =>
  ts.isCallExpression(n) &&
  ((ts.isIdentifier(n.expression) && n.expression.text === 't') ||
    (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 't'));

/**
 * Literals in TEXT position within `node`, i.e. reachable without evaluating anything.
 *
 * The walk stops at every node that is not itself a way of choosing between literals —
 * crucially at calls and at nested JSX. Descending into them is what turns this pass into
 * noise: `label={tagLabel('tag.identity', tag)}` would report the key, and
 * `{cond ? <Pressable className="h-11 w-11" /> : null}` would report Tailwind.
 */
function textLiterals(node, out = []) {
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      out.push({ node: n, text: n.text });
      return;
    }
    if (ts.isTemplateExpression(n)) {
      // A `${t(...)}` anywhere in the template means the copy is already translated and what
      // is left around it is glue.
      let translated = false;
      const seek = (x) => {
        if (isTCall(x)) translated = true;
        else ts.forEachChild(x, seek);
      };
      n.templateSpans.forEach((s) => seek(s.expression));
      if (translated) return;
      const parts = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
      out.push({ node: n, text: parts.join(' '), template: true });
      return;
    }
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n))
      return visit(n.expression);
    // `body: ['Prima riga.', 'Seconda riga.']` — a paragraph list is copy as much as a string is.
    if (ts.isArrayLiteralExpression(n)) return n.elements.forEach(visit);
    if (ts.isConditionalExpression(n)) {
      visit(n.whenTrue);
      visit(n.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(n) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(n.operatorToken.kind)
    ) {
      visit(n.left);
      visit(n.right);
    }
  };
  visit(node);
  return out;
}

/**
 * `.ts` must NOT be parsed in TSX mode. TSX reads `<T>(x) => x` as an unclosed element rather
 * than a generic arrow, so a plain module would misparse and lose its findings silently.
 */
const kindOf = (file) =>
  /\.tsx$/.test(file)
    ? { script: ts.ScriptKind.TSX, variant: ts.LanguageVariant.JSX }
    : { script: ts.ScriptKind.TS, variant: ts.LanguageVariant.Standard };

/**
 * Lines carrying an `i18n-ignore` directive, and whether the file carries `i18n-ignore-file`.
 *
 * Read off comment TOKENS, not off the raw text: a whole-file exemption that any string literal
 * containing `i18n-ignore-file` could trigger would be a silent way to switch the gate off.
 * Scanned only when the substring is present at all, so the common file pays nothing.
 */
function directives(sf, raw, variant) {
  if (!raw.includes('i18n-ignore')) return { file: false, lines: new Set() };
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, raw);
  const lines = new Set();
  let file = false;
  for (let tok = scanner.scan(); tok !== ts.SyntaxKind.EndOfFileToken; tok = scanner.scan()) {
    if (
      tok !== ts.SyntaxKind.SingleLineCommentTrivia &&
      tok !== ts.SyntaxKind.MultiLineCommentTrivia
    )
      continue;
    const text = scanner.getTokenText();
    if (!text.includes('i18n-ignore')) continue;
    if (text.includes('i18n-ignore-file')) file = true;
    const from = sf.getLineAndCharacterOfPosition(scanner.getTokenStart()).line + 1;
    const to = sf.getLineAndCharacterOfPosition(scanner.getTokenEnd()).line + 1;
    for (let l = from; l <= to; l += 1) lines.add(l);
  }
  return { file, lines };
}

/** True when any ancestor satisfies `pred`. */
const hasAncestor = (node, pred) => {
  for (let n = node.parent; n; n = n.parent) if (pred(n)) return true;
  return false;
};

const violations = [];
/** Files whose `i18n-ignore-file` was honoured this run — the guard's input, and the count. */
const exempted = [];
for (const file of ROOTS.flatMap((root) => [...walk(root)])) {
  const raw = readFileSync(file, 'utf8');
  const { script, variant } = kindOf(file);
  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, script);
  const directive = directives(sf, raw, variant);
  if (directive.file) {
    exempted.push(file);
    continue;
  }
  const lineAt = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  /** `i18n-ignore` anywhere in the match's own lines, or on the line above it. */
  const ignored = (from, to) => {
    for (let l = Math.max(1, lineAt(from) - 1); l <= lineAt(to); l += 1)
      if (directive.lines.has(l)) return true;
    return false;
  };
  const seen = new Set();
  /** Report `node`, once per (line, value) — the passes deliberately overlap. */
  const add = (node, value, what) => {
    const from = node.getStart(sf);
    const key = `${lineAt(from)}|${value}`;
    if (seen.has(key) || ALLOWLIST.has(value) || ignored(from, node.getEnd())) return;
    seen.add(key);
    violations.push([file, lineAt(from), what]);
  };
  /** Collapse a literal the way it renders: interpolations become a space. */
  const rendered = (lit) =>
    lit.text
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const isTextName = (name) => !PROP_EXCEPTIONS.has(name) && TEXT_PROP_SUFFIX.test(name);

  /**
   * Module-scope `const X = 'copy'`. Moving a literal to a constant is the first thing a
   * developer reaches for when the gate complains, and it used to work — so the declaration is
   * flagged as soon as the identifier is found in a copy position, and flagged THERE, because
   * that is where the `t()` call has to go.
   */
  const declared = new Map();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const [lit] = textLiterals(d.initializer);
      if (!lit || lit.node !== d.initializer) continue;
      const value = rendered(lit);
      if (looksLikeProse(value) && !I18N_KEY.test(value) && !codeShaped(value))
        declared.set(d.name.text, { decl: d, value });
    }
  }

  const visit = (node) => {
    // --- 1. JSX text children, single- and multi-line, alone or beside `{…}` --------------
    // A run beside an expression is held to a stricter bar: `{t('intro.titolo')} dell'evento`
    // is a translated element with an agreement suffix, while `Ciao {name}, come stai oggi`
    // is a sentence that was never translated at all. Whitespace is what tells them apart.
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim();
      const mixed = (node.parent.children ?? []).some(
        (c) => ts.isJsxExpression(c) && c.expression !== undefined,
      );
      if (text && looksLikeProse(text) && (!mixed || /\s/.test(text))) add(node, text, text);
    }

    // --- 2. JSX expression children: `{'…'}`, `{`…`}`, `{cond ? '…' : '…'}` ---------------
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const lit of textLiterals(node.expression)) {
        const value = rendered(lit);
        if (looksLikeProse(value) && !I18N_KEY.test(value))
          add(lit.node, value, lit.template ? `\`${value}\`` : value);
      }
    }

    // --- 3. text-bearing props, literal or expression -------------------------------------
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer) {
      const prop = node.name.text;
      if (isTextName(prop)) {
        const init = ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        for (const lit of init ? textLiterals(init) : []) {
          const value = rendered(lit);
          if (looksLikeProse(value) && !I18N_KEY.test(value))
            add(lit.node, value, `${prop}="${value}"`);
        }
      }
    }

    // --- 4. text-bearing keys in object literals -------------------------------------------
    // `{ label: 'Vicino a me' }` renders as surely as a prop does, and `propRe`'s `name=`
    // could never see it. Identifier-shaped values are rejected here and only here: an object
    // under a `text` key is as likely to hold a Tailwind class (`{ text: 'text-on-aura' }`) as
    // copy, and unlike a JSX prop nothing about the position settles it. It is `codeShaped`, not
    // «one word», so an Alert button's `text: 'Annulla'` is still reported.
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      const prop = node.name.text;
      if (isTextName(prop)) {
        for (const lit of textLiterals(node.initializer)) {
          const value = rendered(lit);
          if (looksLikeProse(value) && !I18N_KEY.test(value) && !codeShaped(value))
            add(lit.node, value, `${prop}: "${value}"`);
        }
      }
    }

    if (ts.isCallExpression(node) && !isTCall(node)) {
      const callee = node.expression.getText(sf).replace(/\s+/g, '');
      // --- 5. Alert.alert(...) -------------------------------------------------------------
      // Its strings are as user-facing as any <Text>. Only the two positional message args are
      // inspected here — `style: 'cancel' | 'destructive'` are enum values, not copy, and the
      // button `text:` labels come through pass 4's `text` suffix.
      if (callee === 'Alert.alert') {
        for (const arg of node.arguments.slice(0, 2))
          for (const lit of textLiterals(arg)) {
            const value = rendered(lit);
            if (looksLikeProse(value)) add(lit.node, value, `Alert.alert(… "${value}" …)`);
          }
      } else if (!callee.startsWith('console.') && !hasAncestor(node, ts.isThrowStatement)) {
        // --- 6. arguments to any other call ------------------------------------------------
        // Where the toasts live: `showToast('Non è stato possibile salvare')`, `setError(…)`.
        for (const arg of node.arguments)
          for (const lit of textLiterals(arg)) {
            const value = rendered(lit);
            if (looksLikeCopyArgument(value)) add(lit.node, value, `${callee}(… "${value}" …)`);
          }
      }
    }

    // --- 7. a module-scope const, rendered ---------------------------------------------------
    if (ts.isIdentifier(node) && declared.has(node.text)) {
      const { decl, value } = declared.get(node.text);
      const renders =
        hasAncestor(
          node,
          (n) =>
            ts.isJsxExpression(n) &&
            n.parent &&
            (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)),
        ) ||
        hasAncestor(
          node,
          (n) => ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && isTextName(n.name.text),
        );
      if (node !== decl.name && renders) add(decl, value, `${node.text} = "${value}"`);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const unlisted = exempted.filter((f) => guarded(f) && !EXEMPT_FILES.has(f));
const stale = [...EXEMPT_FILES].filter((f) => guarded(f) && !exempted.includes(f));

if (violations.length) {
  console.error(
    'Hardcoded user-facing strings (wrap in t(), add an i18n-ignore comment, or extend ALLOWLIST):',
  );
  for (const [f, ln, txt] of violations) console.error(`  ${f}:${ln}  ${txt}`);
}
if (unlisted.length || stale.length) {
  console.error('EXEMPT_FILES pins which files may carry i18n-ignore-file (rule 5, #443):');
  for (const f of unlisted)
    console.error(
      `  ${f}  carries i18n-ignore-file and is not listed — wrap its copy in t(), or add the path to EXEMPT_FILES and answer for it in review.`,
    );
  for (const f of stale)
    console.error(
      `  ${f}  is listed but no longer carries i18n-ignore-file — drop the entry, it is permission nobody is using.`,
    );
}
if (violations.length || unlisted.length || stale.length) process.exit(1);

const exempt = exempted.length
  ? ` (${exempted.length} file${exempted.length === 1 ? '' : 's'} exempt)`
  : '';
console.log(`i18n:check OK — no hardcoded user-facing strings${exempt}.`);
