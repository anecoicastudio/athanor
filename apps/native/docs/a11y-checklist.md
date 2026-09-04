# M10 a11y — Track-B device-manual checklist

The code-side of frontend `10` §3.2 (A-1…A-5, A-7, A-9) ships in `feat/m10-a11y-pass`.
These items require a physical device + screen reader and are verified at device-QA time
(Expo Go 54.x, both iOS VoiceOver and Android TalkBack). Record pass/fail + device here.

## Built in code (verify on device)

- [ ] A-1 — measure each touched control ≥44pt on device (min-h/hitSlop landed in code).
- [ ] A-7 — toggle Reduce Motion: splash, swipe deck (button alt works), stories (manual-only),
      Aura number (snaps), moment-flash/burst (opacity only), match/level/candidacy/contribution
      overlays (no transforms). Confirm no transform plays.

## Device-only (not buildable on web preview — see [[athanor-mobile-web-smoke-limits]])

- [ ] A-6 — Dynamic Type at largest accessibility size: Profilo, Aura, Annual, Chat — no clip/overlap.
      Code side landed 2026-09-02 (#639): every `Text`/`TextInput` caps at 2× from the `src/tw`
      wrappers, fixed heights became `min-h`, and `source-audit.test.ts` §30 registers the ones
      that stayed fixed. What is left here is the AX3–AX5 render itself — start with the Momenti
      deck well (it now scales with `fontScale`), the fund countdown row, and any header that
      gained a second line.
- [ ] A-8 — VoiceOver (iOS) + TalkBack (Android) critical-path smoke: splash → email+password
      (or Google) login → home → open a Momento → profilo → settings → sign out, driven
      entirely by the screen reader. (Auth is email+password+Google, not OTP; Apple disabled —
      `APPLE_ENABLED=false` in `(auth)/welcome.tsx`.)

## A-2 focus rings — deferred note

RN touch devices have no DOM focus ring; the 2px aura ring matters only for external-keyboard /
switch-control. Not built this slice (large low-value diff, prototype-visual risk). Revisit if
switch-control support becomes a release gate.

## A-9 verdict

PASS — reaction counts conditionally rendered behind `isAuthor` (post/[id].tsx:167-178); countQuery gated `enabled: isAuthor` (line 54); no SR leak. (Re-verified 2026-06-21.)
