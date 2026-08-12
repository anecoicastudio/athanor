import { MEDIA_LIMITS } from '@athanor/core';
import { avatarPath } from './paths';
import { processImage } from './process';
import { uploadLocalFile } from './upload';

/**
 * Process a local image and put it in the `avatars` bucket, returning its storage key (#76).
 *
 * Not a hook, because it has two callers in two different worlds: the Profilo edit form (React,
 * a session in hand) and the post-auth onboarding flush (no component, no session until the OTP
 * lands). Sharing the function is what keeps the EXIF strip on both paths — an avatar uploaded
 * from onboarding would otherwise be the one image in the app that shipped its GPS.
 *
 * Throws on failure; the callers differ on what that means (the form shows an error, the flush
 * shrugs and keeps the rest of the profile).
 */
export async function uploadAvatarImage(uid: string, localUri: string): Promise<string> {
  const processed = await processImage(localUri, {
    maxEdge: MEDIA_LIMITS.AVATAR_MAX_EDGE,
    quality: MEDIA_LIMITS.AVATAR_QUALITY,
  });
  const key = avatarPath(uid);
  await uploadLocalFile(processed.uri, { bucket: 'avatars', path: key }, 'image/jpeg');
  return key;
}
