import { describe, expect, it, vi } from 'vitest';
import {
  createRevealOnFocus,
  REVEAL_PAD,
  revealOffset,
  type RowHandle,
  type ScrollHandle,
} from './reveal-on-focus';

/** A row that answers `measureLayout` synchronously, the way the native call answers late. */
function row(top: number, height: number): RowHandle {
  return {
    measureLayout: (_relativeTo, onSuccess) => onSuccess(0, top, 320, height),
  };
}

/** A row whose measurement never lands — the node went away between focus and callback. */
function deadRow(): RowHandle {
  return {
    measureLayout: (_relativeTo, _onSuccess, onFail) => onFail?.(),
  };
}

function list(): ScrollHandle & { scrollTo: ReturnType<typeof vi.fn> } {
  return {
    getInnerViewNode: () => 7,
    scrollTo: vi.fn(),
  };
}

/** A list that answers `measure` — every real host instance does; the fakes above do not. */
function measurableList(height: number) {
  return {
    getInnerViewNode: () => 7,
    measure: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 0, 320, height),
    scrollTo: vi.fn(),
  };
}

/** The wiring a screen does, collapsed: mount the list, size it, register one row. */
function mounted(opts: { viewport: number; content: number; offset?: number; node?: RowHandle }) {
  const reveal = createRevealOnFocus();
  const scroll = list();
  reveal.scrollProps.ref(scroll);
  reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: opts.viewport } } });
  reveal.scrollProps.onContentSizeChange(320, opts.content);
  if (opts.offset !== undefined) {
    reveal.scrollProps.onScroll({ nativeEvent: { contentOffset: { y: opts.offset } } });
  }
  reveal.rowRef('password')(opts.node ?? row(600, 120));
  return { reveal, scroll };
}

describe('revealOffset — the minimal scroll that puts a row on screen', () => {
  const view = { height: 400, offset: 0, content: 2000 };

  it('leaves a row that is already fully visible alone', () => {
    expect(revealOffset({ top: 100, height: 120 }, view)).toBeNull();
  });

  it('lifts a row that sits below the fold to the bottom edge, padded', () => {
    // bottom = 600 + 120 + PAD, minus the viewport.
    expect(revealOffset({ top: 600, height: 120 }, view)).toBe(600 + 120 + REVEAL_PAD - 400);
  });

  it('pulls a row that is scrolled off the top down to the top edge, padded', () => {
    expect(revealOffset({ top: 300, height: 80 }, { ...view, offset: 500 })).toBe(300 - REVEAL_PAD);
  });

  it('shows the TOP of a row taller than the viewport — the field is up there', () => {
    expect(revealOffset({ top: 600, height: 900 }, view)).toBe(600 - REVEAL_PAD);
  });

  it('never scrolls above the content start', () => {
    expect(revealOffset({ top: 4, height: 40 }, { ...view, offset: 300 })).toBe(0);
  });

  it('never scrolls past the end of the content', () => {
    // Wants 1900 - 400 + PAD; the content only allows 2000 - 400.
    expect(revealOffset({ top: 1900, height: 100 }, view)).toBe(2000 - 400);
  });

  it('does not clamp to the end while the content size is still unknown', () => {
    expect(revealOffset({ top: 900, height: 100 }, { ...view, content: 0 })).toBe(
      900 + 100 + REVEAL_PAD - 400,
    );
  });

  it('holds still for a sub-point correction', () => {
    // Wanted offset lands within a point of where the list already is.
    expect(revealOffset({ top: 412, height: 100 }, { ...view, offset: 124.5 })).toBeNull();
  });

  it('answers null before the list has been laid out', () => {
    expect(revealOffset({ top: 600, height: 120 }, { ...view, height: 0 })).toBeNull();
  });
});

describe('createRevealOnFocus — a focused row is brought into view', () => {
  it('scrolls on focus when the row is under the fold', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000 });
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 600 + 120 + REVEAL_PAD - 400,
      animated: true,
    });
  });

  it('does not scroll when the row already fits on screen', () => {
    const { reveal, scroll } = mounted({ viewport: 800, content: 2000 });
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('re-reveals when the viewport SHRINKS — that is how the keyboard arrives here', () => {
    const { reveal, scroll } = mounted({ viewport: 800, content: 2000 });
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    // KeyboardAvoiding pads the wrapper; this list re-lays out shorter.
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 400 } } });
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 600 + 120 + REVEAL_PAD - 400,
      animated: true,
    });
  });

  it('does not re-reveal when the viewport grows — the keyboard leaving must not scroll', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000 });
    reveal.fieldProps('password').onFocus();
    scroll.scrollTo.mockClear();
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 800 } } });
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('re-reveals when the row GROWS under the field — the password checklist mounting', () => {
    const reveal = createRevealOnFocus();
    const scroll = list();
    reveal.scrollProps.ref(scroll);
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 400 } } });
    reveal.scrollProps.onContentSizeChange(320, 700);
    // The field alone, fully visible at the foot of the viewport.
    reveal.rowRef('password')(row(200, 100));
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    // First keystroke: the checklist mounts, the row (and the content) grow past the fold.
    reveal.rowRef('password')(row(200, 260));
    reveal.scrollProps.onContentSizeChange(320, 860);
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 200 + 260 + REVEAL_PAD - 400,
      animated: true,
    });
  });

  it('ignores a content size that shrinks', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000 });
    reveal.fieldProps('password').onFocus();
    scroll.scrollTo.mockClear();
    reveal.scrollProps.onContentSizeChange(320, 1500);
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('re-reads the offset the member scrolled to', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000, offset: 0 });
    // Scrolled the row past the top edge by hand, then tapped it.
    reveal.scrollProps.onScroll({ nativeEvent: { contentOffset: { y: 900 } } });
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 600 - REVEAL_PAD, animated: true });
  });

  it('does nothing for a key that was never given a row', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000 });
    expect(() => reveal.fieldProps('email').onFocus()).not.toThrow();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('does nothing once the row has been unmounted', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000 });
    reveal.rowRef('password')(null);
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('does nothing before the list has mounted', () => {
    const reveal = createRevealOnFocus();
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 400 } } });
    reveal.rowRef('password')(row(600, 120));
    expect(() => reveal.fieldProps('password').onFocus()).not.toThrow();
  });

  it('does nothing while the list has no measurable content view (web before mount)', () => {
    const reveal = createRevealOnFocus();
    const scroll = { getInnerViewNode: () => null, scrollTo: vi.fn() };
    reveal.scrollProps.ref(scroll);
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 400 } } });
    reveal.rowRef('password')(row(600, 120));
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('survives a measurement that fails', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000, node: deadRow() });
    expect(() => reveal.fieldProps('password').onFocus()).not.toThrow();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('hands back the SAME ref and handler for a key on every call', () => {
    const reveal = createRevealOnFocus();
    // A fresh identity per render would detach and re-attach the row ref every frame.
    expect(reveal.rowRef('password')).toBe(reveal.rowRef('password'));
    expect(reveal.fieldProps('password').onFocus).toBe(reveal.fieldProps('password').onFocus);
    expect(reveal.rowRef('email')).not.toBe(reveal.rowRef('password'));
  });

  it('follows the field the member moves to', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000 });
    reveal.rowRef('email')(row(300, 80));
    reveal.fieldProps('password').onFocus();
    scroll.scrollTo.mockClear();
    reveal.fieldProps('email').onFocus();
    // Focus moved up; the shrink that follows must chase `email`, not the password row.
    scroll.scrollTo.mockClear();
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 200 } } });
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 300 + 80 + REVEAL_PAD - 200,
      animated: true,
    });
  });
});

describe('createRevealOnFocus — the viewport is measured, never assumed', () => {
  it('measures the list at reveal time rather than trusting the last layout event', () => {
    const reveal = createRevealOnFocus();
    // The keyboard has already shrunk the list to 400; no layout event ever said so.
    const scroll = measurableList(400);
    reveal.scrollProps.ref(scroll);
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 800 } } });
    reveal.scrollProps.onContentSizeChange(320, 2000);
    reveal.rowRef('password')(row(600, 120));
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 600 + 120 + REVEAL_PAD - 400,
      animated: true,
    });
  });

  it('falls back to the laid-out height when the list cannot measure itself', () => {
    const { reveal, scroll } = mounted({ viewport: 400, content: 2000 });
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 600 + 120 + REVEAL_PAD - 400,
      animated: true,
    });
  });

  it('does nothing while the measured viewport is still zero', () => {
    const reveal = createRevealOnFocus();
    const scroll = measurableList(0);
    reveal.scrollProps.ref(scroll);
    reveal.rowRef('password')(row(600, 120));
    reveal.fieldProps('password').onFocus();
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });
});

describe('createRevealOnFocus — the settle pass', () => {
  /** Captures the scheduled pass instead of waiting out the keyboard animation. */
  function withSchedule(height: () => number) {
    const passes: (() => void)[] = [];
    const reveal = createRevealOnFocus({ schedule: (run) => passes.push(run) });
    const scroll = {
      getInnerViewNode: () => 7,
      measure: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(0, 0, 320, height()),
      scrollTo: vi.fn(),
    };
    reveal.scrollProps.ref(scroll);
    reveal.scrollProps.onContentSizeChange(320, 2000);
    return { reveal, scroll, passes };
  }

  it('reveals on the settle pass when no layout event ever arrives', () => {
    let height = 800;
    const { reveal, scroll, passes } = withSchedule(() => height);
    reveal.rowRef('password')(row(600, 120));
    reveal.fieldProps('password').onFocus();
    // At the tap the field is still on screen, so the first pass does nothing.
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    expect(passes).toHaveLength(1);
    // The keyboard lands. Nothing tells this hook — it measures again anyway.
    height = 400;
    (passes[0] as () => void)();
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 600 + 120 + REVEAL_PAD - 400,
      animated: true,
    });
  });

  it('drops a settle pass whose field is no longer the focused one', () => {
    let height = 800;
    const { reveal, scroll, passes } = withSchedule(() => height);
    reveal.rowRef('password')(row(600, 120));
    reveal.rowRef('email')(row(200, 80));
    reveal.fieldProps('password').onFocus();
    reveal.fieldProps('email').onFocus();
    height = 400;
    scroll.scrollTo.mockClear();
    (passes[0] as () => void)(); // the password pass, now stale
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    (passes[1] as () => void)(); // the email pass — email fits, so still nothing
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });
});

describe('createRevealOnFocus — blur disarms the reveal', () => {
  it('stops chasing a row once the member has left the field', () => {
    const { reveal, scroll } = mounted({ viewport: 800, content: 2000 });
    reveal.fieldProps('password').onFocus();
    reveal.fieldProps('password').onBlur();
    // The submit failed and an error line mounted: the content grows, but nobody is typing.
    reveal.scrollProps.onContentSizeChange(320, 2200);
    expect(scroll.scrollTo).not.toHaveBeenCalled();
    // Nor does the keyboard leaving and coming back on some other screen's account.
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 400 } } });
    expect(scroll.scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the new field armed when the blur of the old one arrives late', () => {
    const { reveal, scroll } = mounted({ viewport: 800, content: 2000 });
    reveal.rowRef('email')(row(300, 80));
    reveal.fieldProps('email').onFocus();
    // iOS can deliver the incoming focus before the outgoing blur.
    reveal.fieldProps('password').onFocus();
    reveal.fieldProps('email').onBlur();
    reveal.scrollProps.onLayout({ nativeEvent: { layout: { height: 400 } } });
    expect(scroll.scrollTo).toHaveBeenCalledWith({
      y: 600 + 120 + REVEAL_PAD - 400,
      animated: true,
    });
  });

  it('hands back the same field handlers for a key on every call', () => {
    const reveal = createRevealOnFocus();
    expect(reveal.fieldProps('password')).toBe(reveal.fieldProps('password'));
    expect(reveal.fieldProps('email')).not.toBe(reveal.fieldProps('password'));
  });
});
