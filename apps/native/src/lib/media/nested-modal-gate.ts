/**
 * Sequencing for a Modal nested inside another Modal (#859).
 *
 * On iOS every RN `<Modal>` is a presented view controller, and a nested one is presented BY its
 * parent's. Two UIKit rules then bite:
 *
 * - Dismissing a view controller that is itself presenting one dismisses only the child. Hide the
 *   parent in the same batch that closes the child and the parent's dismissal lands on the child
 *   instead, so the parent stays presented. RN still reports `onDismiss` for it, the JS side
 *   unmounts its content, and what is left is an empty full-screen controller that takes every
 *   touch and hides everything from accessibility, with nothing on screen to say so. That was
 *   #859: onboarding's photo sheet after a first permission grant through the primer.
 * - Presenting from a controller that is mid-dismissal fails silently.
 *
 * So on iOS the next step (hide the parent, present a sibling) waits until the child's own
 * `onDismiss` reports it gone, and nothing new is presented while a child is still closing.
 * Android and web stack their modals independently and have no `onDismiss` to wait for, so there
 * the follow-up runs at once.
 *
 * `reset()` exists because a dismissal that never arrives would otherwise hold the gate forever;
 * the parent calls it when it is shown again, the same place it already drops a stale launch.
 */
export type NestedModalGate = {
  /** Start closing the child. `'now'` means it is already safe: unmount the child immediately. */
  closeChild: (then?: () => void) => 'now' | 'deferred';
  /** The child's native dismissal completed (wire it to the child Modal's `onDismiss`). */
  childDismissed: () => void;
  /** A child is still on its way out; presenting anything now would fail silently on iOS. */
  isClosing: () => boolean;
  reset: () => void;
};

export function createNestedModalGate(waitsForDismiss: boolean): NestedModalGate {
  let closing = false;
  let followUp: (() => void) | null = null;

  return {
    closeChild(then) {
      if (!waitsForDismiss) {
        then?.();
        return 'now';
      }
      closing = true;
      followUp = then ?? null;
      return 'deferred';
    },
    childDismissed() {
      const run = followUp;
      closing = false;
      followUp = null;
      run?.();
    },
    isClosing: () => closing,
    reset() {
      closing = false;
      followUp = null;
    },
  };
}
