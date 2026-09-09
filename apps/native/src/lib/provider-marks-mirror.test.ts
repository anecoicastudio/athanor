import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The provider brand marks are transcribed by hand, so this asserts the transcription against
 * the vendor files it was transcribed from (#539).
 *
 * Why a transcription at all: DESIGN §6's third-party carve-out requires the vendor's mandated
 * form, unmodified, which makes the `.svg` in `packages/config/assets/` the source of truth for
 * both the geometry and the colours. Importing that file directly is not available — Metro
 * carries no `react-native-svg-transformer` (`apps/native/metro.config.js` wraps Sentry and
 * NativeWind and nothing else) — so the paths live twice, and "unmodified" is a property that
 * nothing but a test can hold. A drift here is silent by construction: a mangled path still
 * renders, just as a slightly-wrong trademark.
 *
 * The asset lives outside this package, so `apps/native/turbo.json` declares
 * `$TURBO_ROOT$/packages/config/assets/*.svg` as an input. Without it turbo would replay a
 * cached PASS across exactly the edit this file exists to catch.
 *
 * **Colours are compared PAIRED WITH THEIR PATH, not as two sets.** The first draft of this file
 * asserted "every `d` appears somewhere" and "every `fill` appears somewhere" independently, and
 * that is vacuous against the likeliest hand-transcription slip there is: swapping two fills
 * between two paths leaves both sets identical and ships Google's "G" with its quadrants
 * recoloured. Pairs are the property; sets are a proxy that misses it.
 *
 * Attribute extraction is deliberately literal — the attribute values as written — because the
 * assertion is "these two files carry the same bytes", not "these two files describe the same
 * shape". A reformatted asset SHOULD fail: it means someone edited a vendor file.
 */
// `.href`, not the URL object: this app's lib resolves `URL` to the DOM one, which is not
// assignable to node's `fileURLToPath` parameter — the idiom `source-audit.test.ts` and
// `tokens-mirror.test.ts` both use.
const ASSETS = fileURLToPath(new URL('../../../../packages/config/assets/', import.meta.url).href);
const MARKS = fileURLToPath(new URL('../components/provider-marks.tsx', import.meta.url).href);
const SOURCE_AUDIT = fileURLToPath(new URL('./source-audit.test.ts', import.meta.url).href);

const read = (p: string) => readFileSync(p, 'utf8');

/**
 * Every `fill`/`d` pair, in source order, from either spelling — `<path …>` in the asset,
 * `<Path …>` in the component, where prettier wraps the attributes across lines.
 *
 * Anchored on the element, not on a bare attribute scan: `d="…"` alone also matches the `id="…"`
 * that exported SVGs routinely carry (`id="Layer_1"`), which would demand a phantom path of the
 * transcription and fail a correct one. The Apple branch below is the one that will consume a
 * fresh vendor export, so this has to be right before that file lands, not after.
 */
const marks = (src: string): string[] =>
  [...src.matchAll(/<[Pp]ath\s[^>]*?\bfill="([^"]+)"[^>]*?\bd="([^"]+)"[^>]*?\/>/g)].map(
    (m) => `${(m[1] ?? '').toUpperCase()} ${m[2] ?? ''}`,
  );

/**
 * The hex-literal pattern, character for character the one `source-audit.test.ts` §5 bans with —
 * 3, 6 **and** 8 digits.
 *
 * It has to be §5's exact pattern, because this file is the only thing standing behind §5's
 * path exemption. A narrower one here reopens the hole the exemption makes: a 3-digit `#0ff` or
 * an 8-digit `#2BD0D2FF` would be skipped by §5 (which does not read this file at all) and
 * missed here — and `aura` cyan in its 8-digit form is exactly the literal most likely to be
 * reached for. The assertion below pins the two together so they cannot drift apart silently.
 */
const HEX_RE = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g;

/**
 * Comments out, before any hex is counted — the same first move §5 makes, and for a sharper
 * reason here: at three digits the pattern matches an issue reference. `#539` and `#604` are
 * both in this file's prose and in the component's, and counting them as colours makes the
 * assertion below fail on a docblock.
 *
 * Naive about strings and regex literals, deliberately: at worst it masks a little too much,
 * which loses coverage rather than inventing a failure. `<!-- -->` covers the asset, whose
 * header explains the carve-out.
 */
const stripComments = (src: string): string =>
  src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

/** Every hex colour literal in a file's CODE, deduped and sorted. */
const hexes = (src: string): string[] =>
  [...new Set([...stripComments(src).matchAll(HEX_RE)].map((m) => m[0].toUpperCase()))].sort();

describe('the Google mark is the vendor file, unmodified (#539)', () => {
  const asset = read(`${ASSETS}google-g.svg`);
  const source = read(MARKS);
  const assetMarks = marks(asset);

  it('the asset still carries the four-path full-colour mark', () => {
    // A one-path or recoloured asset would make every assertion below vacuously true.
    expect(
      assetMarks.length,
      'packages/config/assets/google-g.svg no longer holds four <path fill … d …> elements. ' +
        'Google ships the "G" as four coloured quadrants; anything else is not the vendor form ' +
        'the DESIGN §6 carve-out permits.',
    ).toBe(4);
    expect(
      hexes(asset).length,
      "Google's mark is four brand colours. A fifth means the asset was edited.",
    ).toBe(4);
  });

  it('every path ships with the colour the vendor file gives it', () => {
    expect(
      marks(source),
      'components/provider-marks.tsx no longer transcribes google-g.svg exactly. The mark must ' +
        "ship unmodified (DESIGN §6, third-party carve-out) — copy each <path>'s fill AND its " +
        '"d" across together. A fill swapped between two paths is the slip this compares pairs ' +
        'to catch: it leaves both sets of values identical and recolours the mark.',
    ).toEqual(assetMarks);
  });

  it('the component introduces no colour the vendor file does not have', () => {
    // The other direction, and the one that matters for rule #4: source-audit §5 exempts this
    // ONE file from the literal-hex ban, so the exemption has to be bounded by something.
    expect(
      hexes(source),
      'components/provider-marks.tsx carries a hex colour that is not in a vendor asset. §5 ' +
        'exempts this file from the literal-hex rule only because every literal in it belongs ' +
        'to a vendor; a colour of our own belongs in @athanor/config.',
    ).toEqual(hexes(asset));
  });

  it('still bans the same hex shapes source-audit §5 does', () => {
    // Not decoration: §5 skips this file entirely, so if its pattern widens and this one does
    // not, the difference is a hex nobody checks. Fails pointing at the divergence rather than
    // letting the gap open quietly.
    expect(
      read(SOURCE_AUDIT).includes(HEX_RE.source),
      'the literal-hex pattern here no longer matches the one source-audit §5 bans with. §5 ' +
        'does not read provider-marks.tsx at all — this file is the whole guard on that ' +
        'exemption, so the two patterns have to stay identical.',
    ).toBe(true);
  });
});

/**
 * Apple's mark is not in the repo (#79 / #95: Apple has not approved the developer account, and
 * the marks archive was not reachable). The clause forbids an approximation, so the CTA ships
 * its slot empty and `providerMark('apple')` returns `null`.
 *
 * Both halves are asserted, so the two states can never disagree silently: while the asset is
 * absent nothing may pretend to be Apple's mark, and the moment it lands the transcription is
 * held to the same standard as Google's. The second branch is dormant today by design — it is
 * the instruction for the day the file arrives, written as a test rather than as a comment.
 *
 * The absent-asset half asserts where the path data IS, not that one formatting of the ternary
 * is present: an `AppleMark` carrying hand-traced geometry could be added under a substring
 * check and stay green as long as `providerMark` still returned null, and a monochrome
 * `fill="black"` carries no hex for the colour assertions above to catch.
 */
describe('the Apple mark is absent rather than approximated (#539)', () => {
  const APPLE = `${ASSETS}apple-mark.svg`;
  const source = read(MARKS);

  it('matches the state of packages/config/assets/apple-mark.svg', () => {
    const googleAt = source.indexOf('export function GoogleMark');
    const providerMarkAt = source.indexOf('export function providerMark');
    expect(googleAt, 'GoogleMark is gone from provider-marks.tsx.').toBeGreaterThan(-1);
    expect(providerMarkAt, 'providerMark is gone from provider-marks.tsx.').toBeGreaterThan(
      googleAt,
    );
    // GoogleMark ends where the next top-level export begins — NOT at `providerMark`, which is
    // the last one. Slicing to `providerMark` would hand the span between the two back to the
    // "outside" it is meant to exclude, and a second mark declared there is exactly where one
    // would be written. That was this assertion's first bug and it made it silent.
    const googleEnd = source.indexOf('export function', googleAt + 1);

    if (!existsSync(APPLE)) {
      // Every drawn path in the file belongs to GoogleMark. A second mark drawn without its
      // vendor file is a traced trademark — the one thing the DESIGN §6 carve-out rules out.
      const outside = source.slice(0, googleAt) + source.slice(googleEnd);
      expect(
        outside.includes('<Path'),
        'apple-mark.svg does not exist, but provider-marks.tsx draws a path outside GoogleMark. ' +
          'A mark drawn without the vendor file is an approximated trademark; ship the slot ' +
          'empty until the file lands.',
      ).toBe(false);
      expect(
        source.slice(providerMarkAt).includes('null'),
        'providerMark must still return null for Apple while the vendor asset is absent — and ' +
          'null, not a component that renders null: Button reserves its icon gutter for any ' +
          'element it is handed.',
      ).toBe(true);
      return;
    }

    const assetMarks = marks(read(APPLE));
    expect(assetMarks.length, 'apple-mark.svg carries no <path fill … d …>.').toBeGreaterThan(0);
    expect(
      marks(source.slice(providerMarkAt === -1 ? 0 : googleAt)).filter((m) =>
        assetMarks.includes(m),
      ),
      'apple-mark.svg has landed but provider-marks.tsx has not been updated: transcribe its ' +
        "<path> into an AppleMark and return it from providerMark's apple branch. Keep the mark " +
        "monochrome in the vendor's own ink — currentColor is not allowed here.",
    ).toEqual(assetMarks);
    expect(
      source.includes('function AppleMark'),
      'apple-mark.svg exists but there is no AppleMark component to render it.',
    ).toBe(true);
  });
});
