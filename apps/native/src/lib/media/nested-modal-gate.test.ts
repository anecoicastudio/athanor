import { describe, expect, it, vi } from 'vitest';
import { createNestedModalGate } from './nested-modal-gate';

describe('createNestedModalGate — iOS waits for the child to be gone (#859)', () => {
  it('defers the follow-up until the child reports dismissed', () => {
    const gate = createNestedModalGate(true);
    const then = vi.fn();

    expect(gate.closeChild(then)).toBe('deferred');
    expect(then).not.toHaveBeenCalled();
    expect(gate.isClosing()).toBe(true);

    gate.childDismissed();
    expect(then).toHaveBeenCalledOnce();
    expect(gate.isClosing()).toBe(false);
  });

  it('runs the follow-up once, even if the dismissal is reported twice', () => {
    const gate = createNestedModalGate(true);
    const then = vi.fn();
    gate.closeChild(then);
    gate.childDismissed();
    gate.childDismissed();
    expect(then).toHaveBeenCalledOnce();
  });

  it('a plain close (no follow-up) still holds the gate until the child is gone', () => {
    const gate = createNestedModalGate(true);
    expect(gate.closeChild()).toBe('deferred');
    expect(gate.isClosing()).toBe(true);
    gate.childDismissed();
    expect(gate.isClosing()).toBe(false);
  });

  it('a dismissal nobody asked for (the child closed on its own) is harmless', () => {
    const gate = createNestedModalGate(true);
    expect(() => gate.childDismissed()).not.toThrow();
    expect(gate.isClosing()).toBe(false);
  });

  it('reset drops a follow-up whose dismissal never arrived', () => {
    const gate = createNestedModalGate(true);
    const then = vi.fn();
    gate.closeChild(then);
    gate.reset();
    expect(gate.isClosing()).toBe(false);
    gate.childDismissed();
    expect(then).not.toHaveBeenCalled();
  });
});

describe('createNestedModalGate — elsewhere nothing is stacked, so nothing waits', () => {
  it('runs the follow-up immediately and never reports closing', () => {
    const gate = createNestedModalGate(false);
    const then = vi.fn();
    expect(gate.closeChild(then)).toBe('now');
    expect(then).toHaveBeenCalledOnce();
    expect(gate.isClosing()).toBe(false);
  });

  it('a later dismissal event does not run the follow-up a second time', () => {
    const gate = createNestedModalGate(false);
    const then = vi.fn();
    gate.closeChild(then);
    gate.childDismissed();
    expect(then).toHaveBeenCalledOnce();
  });
});
