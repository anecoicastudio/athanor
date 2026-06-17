/**
 * Decompose the remaining time between `nowMs` and `targetMs` into d/h/m/s.
 * Pure; `now` is injected (core rule: no inline Date.now). Once the target
 * is reached or passed, every field is 0 and `done` is true — the client
 * never trusts the device clock for the deadline; the real close is enforced
 * server-side (frontend 07 §5).
 */
export function timeRemaining(
  targetMs: number,
  nowMs: number,
): { days: number; hours: number; minutes: number; seconds: number; done: boolean } {
  const remaining = targetMs - nowMs;
  if (remaining <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  }
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, done: false };
}
