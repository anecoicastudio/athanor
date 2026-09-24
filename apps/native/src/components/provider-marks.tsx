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
 * The literal hex values in this file — Google's four, Apple's one — are the ONE sanctioned exception to rule #4 / source-audit §5:
 * they are the vendors' brand colours, not ours, and routing them through an `@athanor/config`
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
 * Apple's logo, transcribed from `packages/config/assets/apple-mark.svg` — Apple's own
 * "Sign in with Apple – Logo only – Black" file from developer.apple.com/design/resources
 * (Logo-Sign-in-with-Apple.dmg, 2026-09-24), copied byte for byte (#79).
 *
 * Black ink on the white `apple` Button variant, the pairing Apple's file itself draws. The
 * path and its fill are the vendor's, unmodified; only the frame differs. The file draws the
 * glyph at 15×19 inside a 56×56 artboard whose white square is clear space, so rendering that
 * artboard at the Google "G"'s size would shrink the logo to a speck. The `viewBox` instead
 * frames the glyph's own height, centred on its axis (x 28), so the logo reads at the same
 * `size` as the "G" beside it. The white square is not drawn: the pill is already
 * `appleButtonBg`, the same white.
 */
export function AppleMark({ size = 18 }: ProviderMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="18.5 16 19 19"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        fill="#000000"
        d="M28.2226562,20.3846154 C29.0546875,20.3846154 30.0976562,19.8048315 30.71875,19.0317864 C31.28125,18.3312142 31.6914062,17.352829 31.6914062,16.3744437 C31.6914062,16.2415766 31.6796875,16.1087095 31.65625,16 C30.7304687,16.0362365 29.6171875,16.640178 28.9492187,17.4494596 C28.421875,18.06548 27.9414062,19.0317864 27.9414062,20.0222505 C27.9414062,20.1671964 27.9648438,20.3121424 27.9765625,20.3604577 C28.0351562,20.3725366 28.1289062,20.3846154 28.2226562,20.3846154 Z M25.2929688,35 C26.4296875,35 26.9335938,34.214876 28.3515625,34.214876 C29.7929688,34.214876 30.109375,34.9758423 31.375,34.9758423 C32.6171875,34.9758423 33.4492188,33.792117 34.234375,32.6325493 C35.1132812,31.3038779 35.4765625,29.9993643 35.5,29.9389701 C35.4179688,29.9148125 33.0390625,28.9122695 33.0390625,26.0979021 C33.0390625,23.6579784 34.9140625,22.5588048 35.0195312,22.474253 C33.7773438,20.6382708 31.890625,20.5899555 31.375,20.5899555 C29.9804688,20.5899555 28.84375,21.4596313 28.1289062,21.4596313 C27.3554688,21.4596313 26.3359375,20.6382708 25.1289062,20.6382708 C22.8320312,20.6382708 20.5,22.5950413 20.5,26.2911634 C20.5,28.5861411 21.3671875,31.013986 22.4335938,32.5842339 C23.3476562,33.9129053 24.1445312,35 25.2929688,35 Z"
      />
    </Svg>
  );
}

/**
 * The mark for a provider CTA.
 *
 * Returns an element for every provider today. If a provider is ever added without its vendor
 * file, return `null` for it — not a component that renders nothing: `Button` reserves its
 * icon gutter for any element it is handed, and cannot see that the element resolved to
 * nothing.
 */
export function providerMark(provider: 'apple' | 'google', size = 18): ReactNode {
  return provider === 'google' ? <GoogleMark size={size} /> : <AppleMark size={size} />;
}
