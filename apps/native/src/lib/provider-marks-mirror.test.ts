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
 * Attribute extraction is deliberately literal — `d="…"` and `fill="…"` as written — because
 * the assertion is "these two files carry the same bytes", not "these two files describe the
 * same shape". A reformatted asset SHOULD fail: it means someone edited a vendor file.
 */
// `.href`, not the URL object: this app's lib resolves `URL` to the DOM one, which is not
// assignable to node's `fileURLToPath` parameter — the idiom `source-audit.test.ts` and
// `tokens-mirror.test.ts` both use.
const ASSETS = fileURLToPath(new URL('../../../../packages/config/assets/', import.meta.url).href);
const MARKS = fileURLToPath(new URL('../components/provider-marks.tsx', import.meta.url).href);

const read = (p: string) => readFileSync(p, 'utf8');

/** Every `<attr>="value"` in source order. */
const attrs = (svg: string, attr: string): string[] =>
  [...svg.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].flatMap((m) => m[1] ?? []);

/** Every hex colour literal in a file, deduped and sorted — comments included, on purpose. */
const hexes = (src: string): string[] =>
  [...new Set([...src.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toUpperCase()))].sort();

describe('the Google mark is the vendor file, unmodified (#539)', () => {
  const asset = read(`${ASSETS}google-g.svg`);
  const marks = read(MARKS);
  const paths = attrs(asset, 'd');
  const fills = attrs(asset, 'fill');

  it('the asset still carries the four-path full-colour mark', () => {
    // A one-path or recoloured asset would make every assertion below vacuously true.
    expect(
      paths.length,
      'packages/config/assets/google-g.svg no longer holds four <path> elements. Google ships ' +
        'the "G" as four coloured quadrants; anything else is not the vendor form the DESIGN §6 ' +
        'carve-out permits.',
    ).toBe(4);
    expect(fills.length).toBe(4);
    expect(
      hexes(asset).length,
      "Google's mark is four brand colours. A fifth means the asset was edited.",
    ).toBe(4);
  });

  it('every path and fill is transcribed into provider-marks.tsx verbatim', () => {
    for (const d of paths) {
      expect(
        marks.includes(d),
        'A <path d> in google-g.svg is not present in components/provider-marks.tsx. The mark ' +
          'must ship unmodified (DESIGN §6, third-party carve-out) — copy the asset\'s "d" ' +
          'across rather than redrawing it.',
      ).toBe(true);
    }
    for (const fill of fills) {
      expect(
        marks.includes(fill),
        `google-g.svg fills with ${fill} and provider-marks.tsx does not. Recolouring a vendor ` +
          'mark is what the carve-out forbids — it is attribution, not iconography.',
      ).toBe(true);
    }
  });

  it('the component introduces no colour the vendor file does not have', () => {
    // The other direction, and the one that matters for rule #4: source-audit §5 exempts this
    // ONE file from the literal-hex ban, so the exemption has to be bounded by something.
    expect(
      hexes(marks),
      'components/provider-marks.tsx carries a hex colour that is not in a vendor asset. §5 ' +
        'exempts this file from the literal-hex rule only because every literal in it belongs ' +
        'to a vendor; a colour of our own belongs in @athanor/config.',
    ).toEqual(hexes(asset));
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
 */
describe('the Apple mark is absent rather than approximated (#539)', () => {
  const APPLE = `${ASSETS}apple-mark.svg`;
  const marks = read(MARKS);

  it('matches the state of packages/config/assets/apple-mark.svg', () => {
    if (!existsSync(APPLE)) {
      expect(
        marks.includes("provider === 'google' ? <GoogleMark size={size} /> : null"),
        'apple-mark.svg does not exist, so providerMark must still return null for Apple. An ' +
          'Apple mark drawn without the vendor file is a traced trademark — the one thing the ' +
          'DESIGN §6 carve-out rules out.',
      ).toBe(true);
      return;
    }
    const asset = read(APPLE);
    const paths = attrs(asset, 'd');
    expect(paths.length, 'apple-mark.svg carries no <path>.').toBeGreaterThan(0);
    for (const d of paths) {
      expect(
        marks.includes(d),
        'apple-mark.svg has landed but provider-marks.tsx has not been updated: transcribe its ' +
          "<path> into an AppleMark and return it from providerMark's apple branch. Keep the " +
          "mark monochrome in the vendor's own ink — currentColor is not allowed here.",
      ).toBe(true);
    }
    expect(
      marks.includes('function AppleMark'),
      'apple-mark.svg exists but there is no AppleMark component to render it.',
    ).toBe(true);
  });
});
