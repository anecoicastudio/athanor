import type { ReactNode } from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * OAuth provider brand marks — the leading mark on the two `welcome.tsx` provider CTAs, and
 * nowhere else (#539). §38 of `lib/source-audit.test.ts` is what keeps "nowhere else" true.
 *
 * These are NOT part of the app's icon vocabulary. DESIGN.md §6's "Esoteric glyph icon set"
 * governs Athanor's own icons — stroke-only sacred geometry in `currentColor`, drawn in the
 * same compass-and-ruler system — and its third-party carve-out clause (ruling 2026-08-24,
 * ratified 2026-08-30, PR #604) exempts a vendor's brand mark from all of it: a provider mark
 * is an attribution requirement, so it ships in the vendor's mandated form, unmodified, and is
 * **never** recoloured to `currentColor`. That is why this file sits beside `glyphs.tsx`
 * rather than inside it, and why nothing here takes a `color` prop.
 *
 * The marks are transcribed from the vendor files in `packages/config/assets/`, which are the
 * source of truth for the path data and the colours; `lib/provider-marks-mirror.test.ts` fails
 * if a transcription drifts from its asset. Importing those `.svg` files instead is not
 * available: `metro.config.js` carries no `react-native-svg-transformer`, so an `.svg` import
 * resolves to nothing on native and to a bare URL on web.
 *
 * Both marks are decorative. The `Button` that renders one already names itself through
 * `accessibilityLabel ?? label` («Continua con Google»), so a mark that announced itself would
 * make the control say its provider twice — hence the two hide props, the pair `Mandorla.tsx`
 * uses. RN-Web renders neither, which is why VoiceOver on these CTAs is device-unverified
 * rather than passed.
 */
export type ProviderMarkProps = { size?: number };

/**
 * Google's "G", full colour, transcribed from `packages/config/assets/google-g.svg`.
 *
 * The four literal hex values are the ONE sanctioned exception to rule #4 / source-audit §5:
 * they are Google's brand colours, not ours, and routing them through an `@athanor/config`
 * token would be exactly the modification the carve-out forbids. §5 names this file and no
 * other.
 */
export function GoogleMark({ size = 18 }: ProviderMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

/**
 * The mark for a provider CTA, or `null` when that vendor's file is not in the repo yet.
 *
 * `null` rather than a component that renders nothing, and the distinction is load-bearing:
 * `Button` reserves its icon gutter for any element it is handed, and cannot see that the
 * element resolved to nothing. Returning `null` here is what keeps the Apple CTA identical to
 * today's — same geometry, same optical centre — instead of a pill with an empty gutter.
 *
 * **Apple's mark is deliberately not drawn.** The carve-out demands the vendor's own file;
 * Apple's logo is distributed through Apple's design resources ("Sign in with Apple" marks),
 * which this session could not reach, and a hand-drawn lookalike is precisely what the clause
 * forbids — an approximated trademark on a store submission is a worse outcome than an absent
 * mark. The day `packages/config/assets/apple-mark.svg` lands, the change is local to this
 * file: transcribe its `<path>` into an `AppleMark` alongside `GoogleMark` (monochrome, the
 * mark's own ink — `currentColor` is not allowed here either) and return it below. The mirror
 * test asserts that contract in both directions: while the asset is absent this file must
 * carry no Apple path data, and once the asset exists the transcription must match it.
 * `welcome.tsx` needs no edit on that day — it already asks for the mark.
 */
export function providerMark(provider: 'apple' | 'google', size = 18): ReactNode {
  return provider === 'google' ? <GoogleMark size={size} /> : null;
}
