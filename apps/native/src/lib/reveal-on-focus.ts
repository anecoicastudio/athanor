/**
 * Bring the FOCUSED field into view, and keep it there (#689).
 *
 * `KeyboardAvoiding` (#614/#616) uncovers the viewport — it pads the wrapper by the keyboard's
 * height, so the ScrollView inside it gets shorter. Nothing moves the content, so a field low
 * in a form is still off screen after the lift, reachable only by scrolling; on the signup
 * screen the password field is the last one and the device walk found that insufficient. This
 * is the other half: the scroll that puts the focused row where the member can see it.
 *
 * ── WHY THIS NEVER TOUCHES A KEYBOARD EVENT ───────────────────────────────────────
 * The keyboard reaches this file as a **layout shrink**, not as an event: the wrapper's padding
 * lands, the list re-lays out shorter, `onLayout` fires. That is the whole coupling. Two
 * consequences, both wanted:
 *
 * - `source-audit.test.ts` §8 stays true — `hooks/use-keyboard-inset.ts` remains the ONLY
 *   subscriber to keyboard show/hide, with exactly its two consumers. A reveal that read the
 *   inset would have had to become a third, and then two mechanisms would own the same fact.
 * - It is cross-platform without a branch. Android's `adjustResize` shrinks the window and the
 *   same `onLayout` fires; iOS gets it through the wrapper.
 *
 * A shrink re-reveals, a GROWTH deliberately does not: the keyboard leaving must not yank the
 * content after it.
 *
 * ── WHY measureLayout AND NOT measureInWindow ─────────────────────────────────────
 * `use-keyboard-inset.ts` carries a standing ban — never `measureInWindow` on a modal screen,
 * because `RNSModalScreenShadowNode` carries the `RootNodeKind` trait and the ancestor walk
 * stops there, so the value comes back sheet-relative while a keyboard frame is window-space.
 * That ban does not bind here, and the reason is structural rather than a hope: this measures a
 * row against the list's OWN content view, an ancestor that sits below the sheet root, so the
 * walk terminates before it ever reaches the boundary that lies. Both nodes live in the same
 * coordinate space by construction, which is the only space this arithmetic uses — the same
 * reason `(modal)/new-password` can wire it.
 *
 * ── THE TWO SHAPES THIS IS NOT ────────────────────────────────────────────────────
 * `automaticallyAdjustKeyboardInsets` (iOS-only, RN 0.81 `ScrollViewPropsIOS`, default false)
 * adds the ScrollView's own keyboard inset ON TOP of the wrapper's `paddingBottom`, so the two
 * double-count unless the wrapper stands down per screen. `scrollResponderScrollNativeHandleTo-
 * Keyboard` is still on the imperative surface and offsets by the keyboard's height — against a
 * viewport this app has already shrunk by exactly that. Both compete with #614; this composes
 * with it, and needs no platform branch to do so.
 *
 * Structural handle types, not RN's: the arithmetic and the sequencing are then testable in the
 * node environment (`reveal-on-focus.test.ts`), which is the only harness `apps/native` has —
 * nothing here can be rendered. `hooks/use-reveal-on-focus.ts` is the React seam over it.
 */

/** How far a revealed row is kept clear of the viewport edge, in points. */
export const REVEAL_PAD = 12;

/**
 * How long the second reveal waits for the keyboard to finish arriving, in ms.
 *
 * The first reveal runs on the focus itself, against a viewport the keyboard has not shrunk
 * yet, and usually concludes there is nothing to do. `onLayout` normally fires next and is the
 * real trigger — but a mechanism on this screen that depends on ONE event arriving is how #616
 * lost two device rounds, and the browser harness already shows an environment where that event
 * never comes (react-native-web fires `onLayout` on mount and not on resize). So the reveal is
 * also re-run on a timer, long enough after the tap for iOS's ~250ms keyboard animation to have
 * landed, and it re-measures rather than trusting anything cached. Both paths are idempotent:
 * whichever arrives second finds the row already in view and returns.
 */
export const KEYBOARD_SETTLE_MS = 350;

/**
 * What `measureLayout` measures against: the host INSTANCE, never a node handle (#752).
 *
 * This used to be `number | object`, and the `number` is what let a handle typecheck all the way
 * to the call. On the New Architecture RN's `ReactNativeElement.measureLayout` rejects anything
 * that is not a host instance by returning early — a `__DEV__`-only warning («ref.measureLayout
 * must be called with a ref to a native component») and NEITHER callback — so the reveal below
 * was a silent no-op on every Fabric build, and a release build said nothing at all.
 */
export type MeasureRelativeTo = object;

/** The half of a native View this file uses — every RN and react-native-web host node has it. */
export type RowHandle = {
  measureLayout(
    // Still admits a `number`, because RN's own signature does and a View has to satisfy this
    // type. What keeps a handle from ever arriving is the other end: `ScrollHandle` can only
    // hand out a `MeasureRelativeTo`.
    relativeTo: number | MeasureRelativeTo,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ): void;
};

/**
 * The half of a ScrollView this file uses. Two of the three are optional because they are the
 * ones that can be absent: react-native-web attaches `getInnerViewRef` to the ref node after
 * mount, and `measure` belongs to the host instance rather than to the component's own API.
 *
 * `getInnerViewRef`, not `getInnerViewNode`: RN 0.86 returns the content view's host instance
 * from the first and a `findNodeHandle` number from the second (`ScrollView.js`), and only the
 * instance survives `measureLayout` (see `MeasureRelativeTo`). react-native-web returns the same
 * DOM node from both, which is why the browser harness never saw the difference. RN's `.d.ts`
 * omits the method — it is on the Flow `ScrollViewImperativeMethods` — and points at the
 * `innerViewRef` PROP instead, which react-native-web does not have.
 */
export type ScrollHandle = {
  getInnerViewRef?: () => MeasureRelativeTo | null | undefined;
  measure?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
  scrollTo(options: { y: number; animated?: boolean }): void;
};

export type RevealOnFocus = {
  /** Spread onto the screen's ScrollView. Owns the list ref and the three measurements. */
  scrollProps: {
    ref: (node: ScrollHandle | null) => void;
    onLayout: (event: { nativeEvent: { layout: { height: number } } }) => void;
    onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
    onContentSizeChange: (width: number, height: number) => void;
    scrollEventThrottle: number;
  };
  /**
   * `ref` for the row that must end up visible — the LABEL, the field and whatever hangs off it
   * (a hint, a password checklist), not the field's own box.
   */
  rowRef: (key: string) => (node: RowHandle | null) => void;
  /**
   * Spread onto the field inside that row, under the same key. Both halves matter: the focus
   * arms the reveal, and the BLUR disarms it — without that, the row stays the reveal's target
   * after the member has left it, and the next thing to grow the content (an error line
   * mounting under a failed submit) scrolls the form back to a field nobody is typing in.
   */
  fieldProps: (key: string, state?: FieldState) => { onFocus: () => void; onBlur: () => void };
  /**
   * Bring a row into view WITHOUT focusing it — the refused submit (#769). A form that refuses
   * «Pubblica» because a field is empty has to show that field and the line saying so, and the
   * member's finger is on a button at the foot of the form, nowhere near either.
   *
   * It DISARMS whatever field is focused first. The refusal mounts an error line, the content
   * grows, and a still-armed multiline field would read that as a line typed at its end and
   * `followFoot` straight back down to it — instantly, after the animated reveal had started
   * up. The field's own blur would disarm it too, but it lands after the growth, not before.
   *
   * Re-run on the settle timer, like a focus: the first pass measures the row before the error
   * line under it has mounted, and before a dismissed keyboard has given the viewport back.
   * Skipped if the member has focused a field by then.
   */
  revealRow: (key: string) => void;
  /**
   * `ref` for the form's submit — the CTA's own block, not a row (#752). Optional: a screen that
   * wires it gets the submit scrolled into view WITH whichever row is focused, whenever the two
   * fit in the viewport together (`revealSpan`); one that does not keeps the row-only reveal.
   *
   * It exists because revealing the row is not the same as keeping the form usable. On
   * `(auth)/welcome` the password row ends at «Forgot your password?», and the CTA sits under it
   * — so the reveal could land the field perfectly and still leave «Sign in» under the keyboard,
   * with nothing on screen to press. On an iPhone with a home indicator the viewport also stops
   * 34pt short of the keyboard: on Fabric, `Screen`'s bottom padding is the safe-area PROVIDER's
   * inset (`RNCSafeAreaViewShadowNode.cpp`), not the view's own, so it stays reserved while
   * `KeyboardAvoiding` has lifted the view off the home indicator. Measured on the iOS
   * simulator, 2026-09-18; the reveal works inside whatever viewport it is given, so it does not
   * depend on that being fixed.
   *
   * A call that hands back one stable ref, like `rowRef(key)`, rather than a ref-valued property:
   * the React Compiler's lint reads a `…Ref` property passed as a value as a ref OBJECT, and then
   * flags every `reveal.*` read during render on the screen (`react-hooks/refs`).
   */
  submitRef: () => (node: RowHandle | null) => void;
};

/**
 * What the screen knows about a field and the controller cannot see — passed on every render,
 * so it is always the current answer (#769).
 */
export type FieldState = {
  /**
   * The field already holds text. On a row taller than the viewport, focusing it lands the FOOT
   * rather than the top: re-entering a long description, the caret is at the end of the text,
   * and "show the top" put it under the keyboard until the first keystroke's `grow` pass came
   * for it (walked on iOS, #769). An empty field has its caret at the top, which the top-first
   * rule already shows.
   */
  hasText?: boolean;
};

export type RevealOptions = {
  /**
   * Runs the settle pass. Defaults to a `KEYBOARD_SETTLE_MS` timer; injected so a test can fire
   * it by hand rather than sleeping.
   */
  schedule?: (run: () => void) => void;
};

/**
 * Where the list must sit for `row` to be visible, or `null` to stay where it is.
 *
 * Minimal by design: a row already on screen is never moved, because tapping a field that the
 * member can already see should not scroll the form under their finger. A row taller than the
 * viewport shows its TOP — the field is up there and the checklist below it is the part that
 * can be scrolled to. (Unless the field already holds text: then the controller lands the foot,
 * where the caret is — see `FieldState.hasText`.)
 */
export function revealOffset(
  row: { top: number; height: number },
  view: { height: number; offset: number; content: number },
): number | null {
  if (view.height <= 0) return null;
  const top = row.top - REVEAL_PAD;
  const bottom = row.top + row.height + REVEAL_PAD;
  // `content` is 0 until the first `onContentSizeChange`; clamping to it then would pin every
  // reveal to the top of the form.
  const end = view.content > 0 ? Math.max(0, view.content - view.height) : Number.POSITIVE_INFINITY;
  const clamp = (y: number) => Math.min(Math.max(y, 0), end);
  const settle = (y: number) => (Math.abs(y - view.offset) < 1 ? null : y);

  if (bottom - top >= view.height) return settle(clamp(top));
  if (top < view.offset) return settle(clamp(top));
  if (bottom > view.offset + view.height) return settle(clamp(bottom - view.height));
  return null;
}

/**
 * Where the list must sit for the FOOT of a row taller than the viewport to be on screen — the
 * foot at the bottom edge, padded — or `null` to stay where it is. The caret of a multiline
 * field being typed into at its end sits down there (#766); see the `grow` rule below.
 */
export function followFoot(
  row: { top: number; height: number },
  view: { height: number; offset: number; content: number },
): number | null {
  if (view.height <= 0) return null;
  const end = view.content > 0 ? Math.max(0, view.content - view.height) : Number.POSITIVE_INFINITY;
  const y = Math.min(Math.max(row.top + row.height + REVEAL_PAD - view.height, 0), end);
  return Math.abs(y - view.offset) < 1 ? null : y;
}

/**
 * `followFoot`, but minimal the way `revealOffset` is: a foot already on screen is left where it
 * is, so focusing a long field whose end the member can see does not move the form (#769).
 */
function footInView(
  row: { top: number; height: number },
  view: { height: number; offset: number; content: number },
): number | null {
  const foot = row.top + row.height;
  if (foot >= view.offset && foot + REVEAL_PAD <= view.offset + view.height) return null;
  return followFoot(row, view);
}

/**
 * What the reveal aims at: the focused row, stretched to take in the form's submit when the two
 * fit in the viewport together — pads included, the same test `revealOffset` applies — and the
 * row alone when they do not, because a field pushed off the top to show its button is worse
 * than a button one scroll away (the return key still submits, #752).
 */
export function revealSpan(
  row: { top: number; height: number },
  submit: { top: number; height: number },
  viewport: number,
): { top: number; height: number } {
  const top = Math.min(row.top, submit.top);
  const bottom = Math.max(row.top + row.height, submit.top + submit.height);
  return bottom - top + 2 * REVEAL_PAD < viewport ? { top, height: bottom - top } : row;
}

/**
 * One reveal controller per screen. Holds the list, the rows by key and the three numbers the
 * arithmetic needs; hands back props to spread and per-key callbacks that are stable for the
 * life of the screen (a fresh ref identity per render would detach and re-attach every row).
 */
export function createRevealOnFocus(options: RevealOptions = {}): RevealOnFocus {
  const schedule =
    options.schedule ??
    ((run: () => void) => {
      setTimeout(run, KEYBOARD_SETTLE_MS);
    });
  let list: ScrollHandle | null = null;
  let viewport = 0;
  let content = 0;
  let offset = 0;
  let focused: string | null = null;
  let submit: RowHandle | null = null;
  const submitRef = (node: RowHandle | null) => {
    submit = node;
  };
  const rows = new Map<string, RowHandle | null>();
  /** Where each row sat when a pass last measured it — what the `grow` rule reads. */
  const seen = new Map<string, { top: number; foot: number }>();
  const rowRefs = new Map<string, (node: RowHandle | null) => void>();
  const fieldHandlers = new Map<string, { onFocus: () => void; onBlur: () => void }>();
  /** `FieldState.hasText` per key, as of the screen's last render. */
  const filled = new Map<string, boolean>();

  /**
   * Which event asked for the reveal, because two of them must be more careful than the rest:
   *
   * - `tap` measures a viewport the keyboard has not shrunk yet, so it reveals the row ALONE: a
   *   row and a submit that fit in THAT viewport are no reason to drag a field the member can
   *   already see from under their finger, towards a button the keyboard is about to cover (it
   *   did, on the iPhone SE signup form). Every later pass runs with the keyboard up and brings
   *   the submit along.
   * - `grow` never shows the TOP of a target taller than the viewport. Growth under a focused
   *   row that already does not fit is a multiline field being typed into — an event or project
   *   description — and "show its top" would bury the caret, which sits at the BOTTOM, once per
   *   new line; on Android it would fight the native caret-follow on every keystroke. Only the
   *   first reveal of a tall row shows its top, and only when the field is empty (#769). Latent until #752: before it, no pass ever
   *   measured anything on a native build.
   *
   *   What it does instead is follow the row's FOOT, and only when that foot was on screen the
   *   last time a pass measured it: the member was at the end of the text, typing there (#766).
   *   Leaving the row alone, as #752 did, buried the caret too — on iOS, where Fabric's
   *   ScrollView never follows a multiline field's caret, so the text ran on under the keyboard
   *   (walked on the iPhone SE, 2026-09-19). A foot that was off screen means the member is
   *   elsewhere — scrolled up, or editing mid-text — and the list stays put; on Android the
   *   native caret-follow owns that case.
   *
   *   And `grow` of any row only chases one the member could still see. A focused field is not
   *   always the one being looked at: under `keyboardShouldPersistTaps="handled"` a chip tap
   *   lands without blurring it, so on `event-create` «Titolo» (the `name` row) stays armed while the member
   *   scrolls down and taps «A pagamento» — and the price row mounting would otherwise snap the
   *   list back up to «Titolo» (#766).
   *
   *   Every scroll `grow` makes is instant, and recorded rather than waiting for `onScroll`: the
   *   content itself just jumped, and the next line can land before an animated scroll reports
   *   — read against the old offset, a row the list was on its way to would look like one the
   *   member scrolled away from, and the follow would stop for the rest of the focus.
   */
  const reveal = (key: string, pass: 'tap' | 'settle' | 'shrink' | 'grow' | 'refuse') => {
    const row = rows.get(key);
    const inner = list?.getInnerViewRef?.();
    if (!row || !list || inner == null) return;
    const scroll = list;
    // Where the row sat BEFORE this pass — read now, because the measurement below replaces it.
    const last = seen.get(key);
    /**
     * A tall row whose field holds text lands its foot, where the caret is (#769). Not on a
     * refusal: that reveal is about the row's label and its error line, which sit at the top.
     */
    const caretAtFoot = (target: { height: number }, view: { height: number }) =>
      pass !== 'refuse' &&
      filled.get(key) === true &&
      target.height + 2 * REVEAL_PAD >= view.height;
    const land = (target: { top: number; height: number }, height: number) => {
      if (pass === 'grow') {
        if (last && (last.foot < offset || last.top > offset + height)) return;
        const tall = target.height + 2 * REVEAL_PAD >= height;
        if (tall && (!last || last.foot > offset + height)) return;
        const view = { height, offset, content };
        const y = tall ? followFoot(target, view) : revealOffset(target, view);
        if (y === null) return;
        scroll.scrollTo({ y, animated: false });
        offset = y;
        return;
      }
      const view = { height, offset, content };
      const y = caretAtFoot(target, view) ? footInView(target, view) : revealOffset(target, view);
      if (y === null) return;
      scroll.scrollTo({ y, animated: true });
    };
    const against = (height: number) => {
      if (height <= 0) return;
      row.measureLayout(
        inner,
        (_x, top, _width, rowHeight) => {
          const field = { top, height: rowHeight };
          seen.set(key, { top, foot: top + rowHeight });
          // Read at callback time: the submit can mount or unmount between the tap and here. A
          // refusal reveals the row alone — the member is looking for the field, not the button.
          const cta = pass === 'tap' || pass === 'refuse' ? null : submit;
          if (!cta) return land(field, height);
          cta.measureLayout(
            inner,
            (_sx, submitTop, _sw, submitHeight) =>
              land(revealSpan(field, { top: submitTop, height: submitHeight }, height), height),
            // A submit that cannot be measured costs the ride-along, never the row's own reveal.
            () => land(field, height),
          );
        },
        // The row unmounted between the tap and the callback — a mode switch mid-focus does it.
        () => undefined,
      );
    };
    // Measured now, not remembered: the viewport this has to fit into is the one the keyboard
    // has already shrunk, and a cached height is only as good as the layout event that set it.
    if (!scroll.measure) return against(viewport);
    scroll.measure((_x, _y, _width, height) => {
      viewport = height;
      against(height);
    });
  };

  return {
    scrollProps: {
      ref: (node) => {
        list = node;
      },
      onLayout: (event) => {
        const next = event.nativeEvent.layout.height;
        if (next === viewport) return;
        // A SHRINK is the keyboard arriving. A growth is it leaving, and chasing that would
        // scroll the form the moment the member dismissed the keyboard.
        const shrank = viewport > 0 && next < viewport;
        viewport = next;
        if (shrank && focused) reveal(focused, 'shrink');
      },
      onScroll: (event) => {
        offset = event.nativeEvent.contentOffset.y;
      },
      onContentSizeChange: (_width, height) => {
        const grew = content > 0 && height > content;
        content = height;
        // The password checklist mounts on the first keystroke, under a field that was fully
        // visible when it was tapped. Growth under the focused row is a second reveal.
        if (grew && focused) reveal(focused, 'grow');
      },
      scrollEventThrottle: 16,
    },
    rowRef: (key) => {
      let ref = rowRefs.get(key);
      if (!ref) {
        ref = (node: RowHandle | null) => {
          rows.set(key, node);
        };
        rowRefs.set(key, ref);
      }
      return ref;
    },
    fieldProps: (key, state) => {
      filled.set(key, state?.hasText === true);
      let props = fieldHandlers.get(key);
      if (!props) {
        props = {
          onFocus: () => {
            focused = key;
            reveal(key, 'tap');
            // Again once the keyboard has landed — see KEYBOARD_SETTLE_MS. Skipped if focus has
            // moved on by then, so a fast tap-through does not drag the form back.
            schedule(() => {
              if (focused === key) reveal(key, 'settle');
            });
          },
          // Only if this field is still the armed one: moving between fields can deliver the
          // new focus before the old blur, and clearing then would disarm the field the member
          // has just moved TO.
          onBlur: () => {
            if (focused === key) focused = null;
          },
        };
        fieldHandlers.set(key, props);
      }
      return props;
    },
    revealRow: (key) => {
      focused = null;
      reveal(key, 'refuse');
      schedule(() => {
        if (focused === null) reveal(key, 'refuse');
      });
    },
    submitRef: () => submitRef,
  };
}
