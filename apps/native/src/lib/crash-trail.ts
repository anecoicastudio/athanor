import AsyncStorage from '@react-native-async-storage/async-storage';
import { devWarn } from '@/lib/log';

/**
 * Durable step markers that survive a native process death (#452).
 *
 * ## Why this exists rather than a log line
 *
 * A native crash raises no JS exception — #449 was an `EXC_BAD_ACCESS` inside JSI, so every
 * `catch`, `devWarn`, LogBox and RN's own global handler were bypassed. Console output also
 * crosses the bridge asynchronously, so the last queued Metro line dies with the process. The
 * only thing that survives is something already written to disk before the dangerous call.
 *
 * ## The constraint the whole design turns on
 *
 * **A marker only helps if its write has RESOLVED before the native boundary it marks.** A
 * fire-and-forget `setItem` dies with the process exactly like a queued console line, and the
 * feature would be a no-op. Verified in the installed `@react-native-async-storage/async-storage`
 * @2.2.0 rather than assumed:
 *
 *  - iOS (`ios/RNCAsyncStorage.mm`): `multiSet` → `_writeEntry` → `_writeManifest`, which is
 *    `[serialized writeToFile:… atomically:YES]` — a synchronous, rename-based write — and only
 *    THEN `callback(...)`. `setItem` resolves on that callback (`src/AsyncStorage.native.ts:84`),
 *    and unlike `getItem` it is not batched behind a `setImmediate`.
 *  - Android (`next/StorageModule.kt:52`): `multiSet` awaits `storage.setValues(entries)` — a
 *    committed SQLite transaction — before `cb(null)`.
 *
 * So `await markStep(…)` means the bytes are on disk. That costs a bridge round-trip per marker,
 * which is why markers are SPARSE: known-dangerous native boundaries only, never a general trace.
 * Route changes are deliberately not marked — a durable write per navigation is not cheap, and
 * Sentry's own in-memory navigation breadcrumbs cover that ground once `initSentry` has run.
 *
 * ## Bounds
 *
 * The ring keeps the last {@link MAX_STEPS}. `RCTInlineValueThreshold` is 1024 bytes
 * (`RNCAsyncStorage.mm:21`): under it the value lives inline in the manifest, so a marker costs
 * ONE atomic file write instead of two. The buffer is sized to stay under that line even when
 * full of the longest step name — `crash-trail.test.ts` pins it.
 *
 * ## Privacy (RUNBOOK §3.5.1)
 *
 * A marker is a step name, never a payload. The vocabulary is a closed set of literals
 * ({@link TRAIL_STEPS}); anything else is dropped on write AND again on read, so neither a
 * mistyped call site nor a poisoned store can put chat text, an email, a token or a media URI
 * into the trail — or into the Sentry event built from it. A device-local file does not exempt
 * us from the denylist.
 */

const KEY = 'athanor.crash-trail.v1';
const VERSION = 1 as const;

/** Ring capacity. See the size assertion in `crash-trail.test.ts` before raising it. */
export const MAX_STEPS = 20;

/**
 * The closed vocabulary. Adding a step means adding it here, which is the point: a call site
 * cannot invent one, so no free-form text can ever reach the store.
 *
 * `app.background` / `app.active` exist to tell an OS kill apart from a crash — a user who
 * force-quits from the app switcher always emits `app.background` first, a jetsam kill or a
 * native crash never does. (A Metro/Expo Go reload restarts the JS context without either, so
 * in dev an unclean verdict is expected and means nothing.)
 */
export const TRAIL_STEPS = [
  'boot.fonts',
  'boot.ready',
  'app.background',
  'app.active',
  'poster.player',
  'poster.thumbnails',
  'poster.render',
  'poster.save',
  'poster.release',
  'poster.done',
] as const;

export type TrailStep = (typeof TRAIL_STEPS)[number];
/** `s` = step, `t` = ms since the session started. Short keys: the 1024-byte budget is real. */
export type TrailEntry = { s: TrailStep; t: number };
export type Trail = { startedAt: number; steps: TrailEntry[] };

type Stored = { v: typeof VERSION; startedAt: number; steps: TrailEntry[] };

const ALLOWED: ReadonlySet<string> = new Set(TRAIL_STEPS);

/** What one launch owns: the trail it inherited, and the one it is writing. */
type Session = { previous: Trail | null; current: Stored };

let started: Promise<Session> | null = null;
/** Serialises writes: two racing `setItem`s could otherwise land out of order and lose a step. */
let writes: Promise<void> = Promise.resolve();

function parseTrail(raw: string | null): Trail | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed?.v !== VERSION) return null;
    if (typeof parsed.startedAt !== 'number' || !Array.isArray(parsed.steps)) return null;
    // Re-check the vocabulary on the way out, not only on the way in: the store is untrusted
    // input, and this trail is about to be rendered and sent.
    const steps = parsed.steps.filter(
      (e): e is TrailEntry =>
        !!e && typeof e === 'object' && ALLOWED.has((e as TrailEntry).s) && Number.isFinite(e.t),
    );
    return { startedAt: parsed.startedAt, steps };
  } catch (e) {
    devWarn('[crash-trail] parse', e);
    return null;
  }
}

/** Queue a write of the current session. Never rejects — a lost marker must not fail a caller. */
function write(current: Stored): Promise<void> {
  const payload = JSON.stringify(current);
  const next = writes.then(async () => {
    try {
      await AsyncStorage.setItem(KEY, payload);
    } catch (e) {
      devWarn('[crash-trail] write', e);
    }
  });
  writes = next;
  return next;
}

/**
 * Read the previous run's trail, then claim the slot for this run.
 *
 * The claiming write is what makes a trail report exactly once: without it, a launch that dies
 * before its first marker would re-read — and re-report — the same old trail forever.
 */
async function start(): Promise<Session> {
  let previous: Trail | null = null;
  try {
    previous = parseTrail(await AsyncStorage.getItem(KEY));
  } catch (e) {
    devWarn('[crash-trail] read', e);
  }
  const current: Stored = { v: VERSION, startedAt: Date.now(), steps: [] };
  await write(current);
  return { previous, current };
}

/**
 * The session, started at most once. Both public entry points go through it, so a marker written
 * before anything read the previous trail still preserves it — there is no call order to get
 * wrong, which is the whole reason the state is threaded through here rather than kept as a
 * nullable module global that every caller would then have to guard.
 */
function ensureStarted(): Promise<Session> {
  started ??= start();
  return started;
}

/**
 * Record a step, durably, before the native call it marks.
 *
 * **Await this at the call site.** An un-awaited marker buys nothing: the whole point is that the
 * write has landed before the process can die. Resolves even when the write failed — a marker is
 * a diagnostic, never a reason to fail the work it is watching.
 */
export async function markStep(step: TrailStep): Promise<void> {
  if (!ALLOWED.has(step)) return;
  const { current } = await ensureStarted();
  current.steps = [...current.steps, { s: step, t: Date.now() - current.startedAt }].slice(
    -MAX_STEPS,
  );
  await write(current);
}

/**
 * The previous run's trail, or null on a first launch. Idempotent and cached: the read happens
 * once per process, so calling this from more than one place is free.
 */
export async function readPreviousTrail(): Promise<Trail | null> {
  return (await ensureStarted()).previous;
}

/**
 * Did the previous run end the way a healthy app ends? A backgrounded app that the OS later
 * reclaims is ordinary; a run whose last step is anything else stopped where it stood.
 */
export function endedCleanly(trail: Trail): boolean {
  return trail.steps[trail.steps.length - 1]?.s === 'app.background';
}

/** One line a developer can read in the Metro console. Step names only — see the privacy note. */
export function describeTrail(trail: Trail): string {
  const started = new Date(trail.startedAt).toISOString();
  const steps = trail.steps.map((e) => `${e.s}+${e.t}ms`).join(' → ');
  return `${started} | ${steps || '(no steps reached)'}`;
}
