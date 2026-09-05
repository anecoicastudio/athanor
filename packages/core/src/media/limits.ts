/**
 * MEDIA_LIMITS — the single source of upload/processing bounds (rule #10).
 * Server-tunable later; never scatter these numbers. Mirrors resilience §7.
 */
export const MEDIA_LIMITS = {
  /** Re-encode images down to this long edge (EXIF strip + size) — resilience §7.1/§7.2. */
  IMAGE_MAX_LONG_EDGE: 2048,
  /** JPEG quality for the re-encode pass (0–1). */
  IMAGE_QUALITY: 0.8,
  /**
   * Long edge of the poster frame extracted from a video. A third of a phone screen is what
   * this ever fills (the Momenti grid is 3 columns), so IMAGE_MAX_LONG_EDGE would be paying
   * for pixels the tile cannot show — and every video Momento pays it twice, once in bytes
   * and once in the signed-URL fetch.
   */
  VIDEO_POSTER_MAX_EDGE: 1024,
  /** JPEG quality for the poster encode (0–1). Lower than a real photo: it is a thumbnail. */
  VIDEO_POSTER_QUALITY: 0.7,
  /**
   * How far into a clip the poster frame is taken. Not zero: frame zero is where a fade-in,
   * a lens cap or an auto-exposure ramp lives, and a black poster is the bug this replaces.
   */
  VIDEO_POSTER_SECONDS: 0.5,
  /**
   * How long a poster extraction may run before the caller gives up on it (#412).
   *
   * `extractVideoPoster` has no timeout of its own — neither `replaceAsync` nor
   * `generateThumbnailsAsync` is bounded — and an HEVC clip the decoder must seek, or an
   * iCloud-backed `PHAsset`, can take a very long time or never settle. That matters because
   * the candidacy upload awaits the poster BEFORE it reports success: the video is already in
   * Storage, so an unbounded wait trades a finished upload for a tile that spins forever.
   * A poster is best-effort by design (it degrades to a null `thumb_path`), so bounding it
   * costs a thumbnail and saves the submission.
   */
  VIDEO_POSTER_TIMEOUT_MS: 15_000,
  /**
   * How long the poster extractor waits for the player to finish loading its source before it
   * asks for a frame anyway.
   *
   * `replaceAsync` does not mean the item is installed: on iOS it resolves as soon as the
   * install has been *scheduled* on the main queue, and `generateThumbnailsAsync` then finds
   * `currentItem == nil` and returns an empty array — a video that uploads perfectly and
   * arrives with no poster at all. So the extractor waits for the player's `sourceLoad`, and
   * this is how long that wait may take before it gives up and tries regardless (which is
   * exactly the old behaviour, so the deadline can only ever cost latency, never an outcome).
   *
   * Strictly smaller than `VIDEO_POSTER_TIMEOUT_MS`, which bounds the whole extraction: this
   * is the first of four steps, and a load deadline at the outer budget would leave nothing
   * for generate, render and save.
   */
  VIDEO_POSTER_LOAD_TIMEOUT_MS: 5_000,
  /**
   * Long edge of a processed avatar (#76). The largest an avatar is ever drawn is the 104pt
   * profile hero, so even a 3× screen asks for ~312px; 512 leaves headroom without paying for
   * a camera original that every list row would then downscale on the fly. The bucket's own
   * 5 MiB ceiling is the backstop, not the target.
   */
  AVATAR_MAX_EDGE: 512,
  /** JPEG quality for the avatar encode (0–1). A face at 512px, not a photograph to zoom into. */
  AVATAR_QUALITY: 0.8,
  /**
   * Hard cap on a personal/post CLIP — video and audio alike.
   *
   * Enforced in three places, and the header's "single source" claim is only as true as they
   * agree: the capture doors refuse a longer clip on every path (`toPickedMedia` /
   * `classifyVideoAsset` for video, the recorder's own `forDuration` stop for audio),
   * `packages/schemas` refuses to parse one, and `moments`, `story_segments` and `post_media`
   * each carry a `between 0 and 60` CHECK so a client that is not our app cannot write one
   * either. `post_media` was the exception until #56 — its CHECK said 1200 for two months
   * while this line said 60, which is the shape of drift a constant cannot detect on its own.
   * `packages/schemas/src/post-media-duration.mirror.test.ts` now pins this number to the
   * schema, to the SQL, and to the two catalog sentences that spell it in prose.
   *
   * **It said `MAX_VIDEO_SECONDS` until #154, and the name was the last thing about it that
   * was video-only.** The `post_media_duration_s_check` has never carried a `kind` predicate
   * — `duration_s` is one column — so this bound has always applied to an audio row too;
   * there was simply no surface that could produce one. #154 built the recorder, and the
   * choice then was a kind-conditional CHECK giving audio its own bound, or this one. This
   * one, because the cap is a property of a POST rather than of a codec: a post may carry
   * both kinds at once and `derivePostType` collapses it to a single type, so a voice note
   * running five times longer than the video beside it would make one number mean two things
   * in one card. `MAX_POST_MEDIA` is 10, so 60s already buys ten minutes per post — and
   * giving audio a longer bound than video would hand the lighter medium the larger claim on
   * a reader's time.
   */
  MAX_CLIP_SECONDS: 60,
  /**
   * Hard cap on the bytes of a picked video, checked BEFORE the upload starts (#412).
   *
   * 100 MiB is not a taste: it is exactly `MAX_BYTES` in `supabase/functions/media-process`,
   * which skips any object above it because the edge isolate would OOM holding ~2× the file.
   * A larger video therefore uploads for minutes over a phone connection and then silently
   * misses the server-side strip — so the number the client accepts is the number the
   * backstop can still process, and the member is told «troppo pesante» in one second
   * instead of finding out never.
   *
   * **Raising this re-arms #450.** It is now the only bound left on the contiguous iOS
   * allocation: `MAX_CLIP_SECONDS` stopped being one when #56 settled at 60s, because seconds
   * do not bound bytes — a 60s 4K clip and a 60s 720p clip differ by an order of magnitude.
   * On iOS `xhr.send({ uri })` materialises the whole file in one native buffer before the
   * request leaves (`RCTNetworkTask.mm` → `NSMutableData` → `HTTPBody`), so the largest number
   * this constant permits is the largest single allocation an upload asks the OS for, inside
   * Expo Go, where there is no native uploader to fall back to. #450 is DEFERRED, not fixed —
   * its blocker, #508's SDK 54 pin, lifted on 2026-09-05 — and this ceiling is what makes
   * deferring it survivable.
   * There is a good product reason to want longer, heavier video one day; take it together
   * with #450, not before it.
   */
  MAX_VIDEO_BYTES: 100 * 1024 * 1024,
  /**
   * iOS capture quality for an in-app recording (#449). The **name** of an
   * `ImagePicker.UIImagePickerControllerQualityType` member, indexed into that enum at the call
   * site — this package imports no expo, and a name means a renamed member is a type error
   * rather than an ordinal that quietly changes meaning.
   *
   * The picker's default is `High`, which on an iPhone records at the device maximum: 4K/60 is
   * ~400 MB per minute. That number is not merely large, it is fatal. `xhr.send({ uri })`
   * streams on Android but on iOS materialises the whole file in one native allocation
   * (`RCTNetworkTask.mm` appends into an NSMutableData, then `RCTNetworking.mm` assigns it as
   * `HTTPBody`), so the bytes the picker hands back are bytes that must fit in RAM inside Expo
   * Go. Recording at `Medium` is what keeps them under the OS jetsam threshold.
   */
  VIDEO_CAPTURE_QUALITY_IOS: 'Medium',
  /**
   * iOS export preset for a video picked from the library (#449). The **name** of an
   * `ImagePicker.VideoExportPreset` member, indexed at the call site for the same reason as
   * `VIDEO_CAPTURE_QUALITY_IOS`.
   *
   * The default is `Passthrough`, which is literally "do not compress": a 33-second 4K clip
   * arrives at ~220 MB and is refused by `MAX_VIDEO_BYTES` before it can even crash. Any other
   * member makes expo-image-picker run an `AVAssetExportSession` over the asset and hand back
   * the transcoded mp4 instead — `MediaHandler.swift`'s `handleVideo(from: PHPickerResult)`
   * does this independently of which native controller presented the picker, so it applies on
   * iOS 14+ where selection goes through `PHPickerViewController`.
   *
   * `MediumQuality` is the conservative choice. If it reads too soft on device,
   * `H264_1280x720` is the predictable alternative and this constant is the only edit.
   */
  VIDEO_LIBRARY_EXPORT_PRESET_IOS: 'MediumQuality',
  /**
   * The video container types an upload may declare. Mirrors the `candidacy-videos` bucket's
   * `allowed_mime_types` and the pgTAP assertion in `0043_candidacy_videos_storage.test.sql`.
   *
   * QuickTime is here because an iPhone camera records `.mov`, and Expo Go cannot transcode
   * (a native module would break App Store Expo Go, which is the only way this app reaches
   * testers — mobile.md). The alternative to accepting it was mislabelling it `video/mp4`,
   * which is what `use-candidacy-upload` used to do: the header passed the bucket check while
   * QuickTime bytes landed under an mp4 label in `storage.objects.metadata`.
   */
  VIDEO_MIME_TYPES: ['video/mp4', 'video/quicktime'],
  /**
   * The audio container types an upload may declare (#154). Mirrors the `post-media` bucket's
   * `allowed_mime_types` — and ONLY that bucket's: `moments` and `story-segments` accept no
   * audio at all, which is why the recorder is offered in the post composer and nowhere else.
   *
   * `audio/mpeg` is in the list because the bucket has accepted it since 20260614204500 and
   * `media-process` strips ID3v2/ID3v1 for it, not because anything here produces one — the
   * recorder always writes MPEG-4/AAC. It is the container an import path would bring, kept
   * so the client list and the bucket list stay the same list.
   */
  AUDIO_MIME_TYPES: ['audio/mp4', 'audio/mpeg'],
  /**
   * What the recorder declares for the file it produced (#154).
   *
   * Resolved against {@link MEDIA_LIMITS.AUDIO_MIME_TYPES} rather than asserted, on the #461
   * precedent: the bucket filters on the declared header, not on the bytes, so a container
   * outside the list has to be refused by name instead of relabelled into acceptance. That
   * matters here more than it looks — see `AUDIO_EXTENSION` for the platform that gets this
   * wrong.
   */
  AUDIO_CONTENT_TYPE: 'audio/mp4',
  /**
   * The file extension the recorder writes, and the reason none of `expo-audio`'s presets can
   * be used as-is.
   *
   * `RecordingPresets.HIGH_QUALITY` is `.m4a` on iOS and Android but declares `audio/webm` on
   * **web**, and `RecordingPresets.LOW_QUALITY` is `.3gp` (`audio/3gpp`) on Android. Neither
   * is in `AUDIO_MIME_TYPES`, so either would upload and then 415 at the bucket. Spelling the
   * options out is what keeps the recorder's output and the bucket's allowlist the same set
   * on the two platforms that matter, and what makes the web case a NAMED refusal rather than
   * a failed upload.
   */
  AUDIO_EXTENSION: '.m4a',
  /** Mono. A voice note has one speaker; stereo doubles the bytes to encode the same thing. */
  AUDIO_CHANNELS: 1,
  /**
   * Voice-grade AAC. A 60s clip lands around half a megabyte — three orders of magnitude under
   * the post-media bucket's 50 MiB object cap, which is why audio needs no byte limit of its
   * own the way video does. `MAX_VIDEO_BYTES` exists because a camera picks its own bitrate
   * and seconds therefore do not bound bytes; here the bitrate is fixed on this line, so
   * `MAX_CLIP_SECONDS` bounds both.
   */
  AUDIO_BIT_RATE: 64_000,
  /** Matches the presets. Below this, AAC starts costing intelligibility on consonants. */
  AUDIO_SAMPLE_RATE: 44_100,
  /**
   * iOS output format + quality for a recording (#154). The **names** of `expo-audio`'s
   * `IOSOutputFormat` and `AudioQuality` members, indexed into those enums at the call site
   * for the same reason as `VIDEO_CAPTURE_QUALITY_IOS`: this package imports no expo, and a
   * name makes a renamed member a type error rather than an ordinal that quietly changes
   * meaning. MPEG4AAC is what puts the recording in the `.m4a` container the bucket accepts.
   */
  AUDIO_OUTPUT_FORMAT_IOS: 'MPEG4AAC',
  AUDIO_QUALITY_IOS: 'MEDIUM',
  /**
   * Android output format + encoder (#154). Plain string unions in `expo-audio` rather than
   * enums, so these are the values themselves. `mpeg4` + `aac` is the pair that yields the
   * same `.m4a`/`audio/mp4` file iOS produces — `3gp` + `amr_nb` (what LOW_QUALITY selects)
   * would not.
   */
  AUDIO_OUTPUT_FORMAT_ANDROID: 'mpeg4',
  AUDIO_ENCODER_ANDROID: 'aac',
  /**
   * Max media items attached to one post (multi-image).
   *
   * Since #591 this is a database constraint too, and therefore a migration-gated product
   * constant: `post_media.position` is bounded to `[0, MAX_POST_MEDIA)` and (post_id, position)
   * is unique, so the table admits exactly this many rows per post whoever writes them. Editing
   * the number here alone changes nothing a direct API caller can reach and reds
   * `packages/schemas/src/post-media-count.mirror.test.ts`; it moves with a migration or not at
   * all.
   */
  MAX_POST_MEDIA: 10,
  /** Caption character cap (matches moments.caption CHECK). */
  MAX_CAPTION: 280,
} as const;

export type MediaLimitKey = keyof typeof MEDIA_LIMITS;
