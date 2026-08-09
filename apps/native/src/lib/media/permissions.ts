import * as ImagePicker from 'expo-image-picker';
import { type PermStatus, toPeekStatus, toStatus } from './permission-status';

// `PermStatus` + the two granted/canAskAgain → status mappings live in
// ./permission-status, which imports nothing native and so stays reachable from
// the node test runner. Re-exported so existing `from './permissions'` imports resolve.
export type { PermStatus };

/** Current camera status WITHOUT prompting — seeds the primer. */
export async function peekCameraPermission(): Promise<PermStatus> {
  return toPeekStatus(await ImagePicker.getCameraPermissionsAsync());
}

/** Current photo-library status WITHOUT prompting — seeds the primer. */
export async function peekLibraryPermission(): Promise<PermStatus> {
  return toPeekStatus(await ImagePicker.getMediaLibraryPermissionsAsync());
}

/**
 * Resolve the camera permission. Reads the current status first; only fires the
 * OS prompt when still `undetermined` (i.e. the OS can still ask). Callers prime
 * with {@link PermissionPrimer} before invoking this so the OS dialog is expected.
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

/**
 * Resolve the photo-library permission. Prefers iOS limited access — we never
 * request `writeOnly` and never force full-library; the user keeps the
 * limited-PHPicker selection if they granted it. Same read-then-request-once
 * flow as the camera so an already-decided permission never re-prompts.
 */
export async function ensureLibraryPermission(): Promise<PermStatus> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  // `limited` (iOS 14+) reports `granted: true` — limited access is enough for
  // the PHPicker flow, so we accept it as granted rather than nagging for full.
  if (current.granted) return 'granted';
  if (current.canAskAgain) {
    const next = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return toStatus(next);
  }
  return 'blocked';
}
