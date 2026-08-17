-- #412: the candidacy-videos bucket accepts QuickTime.
--
-- An iPhone camera records .mov, and `video/quicktime` was not in `allowed_mime_types`
-- (`{video/mp4,image/jpeg}` since 20260812120121). The client hid that by hard-coding a
-- 'video/mp4' Content-Type for every upload: the header passed the bucket check while
-- QuickTime bytes landed under an mp4 label in storage.objects.metadata. So the primary
-- capture path on iOS was never actually accepted — it was mislabelled into acceptance.
--
-- Widening rather than converting: transcoding would need a native module, and a native
-- module breaks App Store Expo Go, which is the only way this app currently reaches testers
-- (.claude/rules/mobile.md). Nothing downstream re-encodes either — media-process strips
-- metadata and processVideo is a passthrough — so a container this bucket refuses is a
-- container the member simply cannot submit.
--
-- image/jpeg stays: the poster frame `{uid}/{id}-thumb.jpg` shares this bucket (#282).
-- The client mirrors this list in MEDIA_LIMITS.VIDEO_MIME_TYPES (packages/core/src/media/
-- limits.ts) and rejects anything outside it before uploading, so a refusal is named on the
-- tile instead of arriving as a 415 nobody rendered.
--
-- file_size_limit (200 MB) is untouched; the client's own 100 MiB cap is tighter on purpose,
-- because media-process skips objects above that.
update storage.buckets
   set allowed_mime_types = array['video/mp4', 'video/quicktime', 'image/jpeg']
 where id = 'candidacy-videos';
