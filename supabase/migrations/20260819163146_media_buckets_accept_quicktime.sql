-- #461: the post-media, moments and story-segments buckets accept QuickTime.
--
-- The same defect #412 closed for candidacy-videos, one sweep short of the other three
-- buckets. An iPhone camera records .mov (`recordVideo` sets videoQuality but no
-- videoExportPreset, so nothing transcodes it), and `video/quicktime` was in none of these
-- allowed_mime_types lists. The client hid that by hard-coding a 'video/mp4' Content-Type for
-- every video in `processAndUpload`: the buckets filter on the declared header, not on the
-- bytes, so the header always passed while QuickTime bytes landed under an mp4 label in
-- storage.objects.metadata. The primary capture path on iOS was never actually accepted — it
-- was mislabelled into acceptance.
--
-- Widening rather than converting, for the reason 20260817095356 gives: transcoding needs a
-- native module, and a native module breaks App Store Expo Go, which is the only way this app
-- currently reaches testers (.claude/rules/mobile.md). Nothing downstream re-encodes either —
-- media-process strips metadata and processVideo is a passthrough.
--
-- This migration is the second half of a pair. The client now resolves the real type through
-- `resolveVideoContentType` and mirrors this list in MEDIA_LIMITS.VIDEO_MIME_TYPES
-- (packages/core/src/media/limits.ts), refusing anything outside it before uploading. Landing
-- the client half alone would turn today's silent mislabel into a hard 415.
--
-- Every other member of each list is carried over verbatim: the image types the composers
-- upload, the two audio types post-media has always accepted, and image/jpeg for the poster
-- frames that share these buckets (`{uid}/{id}-thumb.jpg`). file_size_limit is untouched.
update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'video/mp4', 'video/quicktime',
         'audio/mp4', 'audio/mpeg'
       ]
 where id = 'post-media';

update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'video/mp4', 'video/quicktime'
       ]
 where id in ('moments', 'story-segments');
