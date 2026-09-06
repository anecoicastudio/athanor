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

/** What `measureLayout` measures against: a node handle, or the host instance itself. */
export type MeasureRelativeTo = number | object;

/** The half of a native View this file uses — every RN and react-native-web host node has it. */
export type RowHandle = {
  measureLayout(
    relativeTo: MeasureRelativeTo,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void,
  ): void;
};

/**
 * The half of a ScrollView this file uses. Two of the three are optional because they are the
 * ones that can be absent: react-native-web attaches `getInnerViewNode` to the ref node after
 * mount, and `measure` belongs to the host instance rather than to the component's own API.
 */
export type ScrollHandle = {
  getInnerViewNode?: () => MeasureRelativeTo | null | undefined;
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
  fieldProps: (key: string) => { onFocus: () => void; onBlur: () => void };
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
 * can be scrolled to.
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
  const rows = new Map<string, RowHandle | null>();
  const rowRefs = new Map<string, (node: RowHandle | null) => void>();
  const fieldHandlers = new Map<string, { onFocus: () => void; onBlur: () => void }>();

  const reveal = (key: string) => {
    const row = rows.get(key);
    const inner = list?.getInnerViewNode?.();
    if (!row || !list || inner == null) return;
    const scroll = list;
    const against = (height: number) => {
      if (height <= 0) return;
      row.measureLayout(
        inner,
        (_x, top, _width, rowHeight) => {
          const y = revealOffset({ top, height: rowHeight }, { height, offset, content });
          if (y === null) return;
          scroll.scrollTo({ y, animated: true });
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
        if (shrank && focused) reveal(focused);
      },
      onScroll: (event) => {
        offset = event.nativeEvent.contentOffset.y;
      },
      onContentSizeChange: (_width, height) => {
        const grew = content > 0 && height > content;
        content = height;
        // The password checklist mounts on the first keystroke, under a field that was fully
        // visible when it was tapped. Growth under the focused row is a second reveal.
        if (grew && focused) reveal(focused);
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
    fieldProps: (key) => {
      let props = fieldHandlers.get(key);
      if (!props) {
        props = {
          onFocus: () => {
            focused = key;
            reveal(key);
            // Again once the keyboard has landed — see KEYBOARD_SETTLE_MS. Skipped if focus has
            // moved on by then, so a fast tap-through does not drag the form back.
            schedule(() => {
              if (focused === key) reveal(key);
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
  };
}
