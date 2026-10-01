import * as ImagePicker from 'expo-image-picker';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { type PermStatus, toPeekStatus, toStatus } from './permission-status';

// `PermStatus` + the two granted/canAskAgain → status mappings live in
// ./permission-status, which imports nothing native and so stays reachable from
// the node test runner. Re-exported so existing `from './permissions'` imports resolve.
export type { PermStatus };

/** Current camera status WITHOUT prompting. */
export async function peekCameraPermission(): Promise<PermStatus> {
  return toPeekStatus(await ImagePicker.getCameraPermissionsAsync());
}

/**
 * Current photo-library status WITHOUT prompting. There is no `ensure` twin, on purpose (#908,
 * 2026-10-01): the system picker needs no photo permission, so nothing in the app requests one.
 * The peek survives only to explain a launch that came back empty (`use-candidacy-upload.ts`).
 */
export async function peekLibraryPermission(): Promise<PermStatus> {
  return toPeekStatus(await ImagePicker.getMediaLibraryPermissionsAsync());
}

/**
 * Resolve the camera permission. Reads the current status first; only fires the
 * OS prompt when still `undetermined` (i.e. the OS can still ask). Callers invoke this
 * straight from the tap on the feature: no sheet of ours comes before the OS dialog (#908,
 * Marco's ruling 2026-10-01 — App Review Guideline 5.1.1(iv)).
 */
export async function ensureCameraPermission(): Promise<PermStatus> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return 'granted';
  // Only the very first ask is `undetermined` + `canAskAgain` → request once.
  if (current.canAskAgain) {
    const next = await ImagePicker.requestCameraPermissionsAsync();
    return toStatus(next);
  }
  return 'blocked';
}

/** Current microphone status WITHOUT prompting (#154). */
export async function peekMicrophonePermission(): Promise<PermStatus> {
  return toPeekStatus(await getRecordingPermissionsAsync());
}

/**
 * Resolve the microphone permission. Same read-then-request-once flow as the camera, so an
 * already-decided permission never re-prompts and a `blocked` one deep-links to Settings
 * instead of firing a dialog iOS will not show.
 *
 * The permission comes from `expo-audio`, not from `expo-image-picker`, even though both can
 * ask for a microphone: image-picker's request is attached to recording a VIDEO, and asking
 * through it for a voice note would work while making the iOS prompt arrive from the wrong
 * feature. `AudioModule` is the module that will actually hold the mic.
 */
export async function ensureMicrophonePermission(): Promise<PermStatus> {
  const current = await getRecordingPermissionsAsync();
  if (current.granted) return 'granted';
  // Only the very first ask is `undetermined` + `canAskAgain` → request once.
  if (current.canAskAgain) return toStatus(await requestRecordingPermissionsAsync());
  return 'blocked';
}
