-- #582 ruling (2026-08-30): narrow chat-media's allowed_mime_types to image/jpeg alone.
--
-- 20260827054252 opened the bucket to jpeg/png/webp while every other layer pins `.jpg`
-- keys alone (messages_user_shape's media_url check, the chatMediaKey Zod regex, the
-- storage policies rewritten by 20260827092629, chatMediaPath()). The client path produces
-- JPEG only, so the wider allowlist was surface without a producer — PNG bytes could
-- legally sit under a .jpg key.
--
-- The paired unknown 0136 recorded ("does Storage serve the stored content-type or infer
-- one from the key name?") was answered by probe against hosted staging on 2026-08-31:
-- Storage serves the STORED content-type. A 1x1 PNG uploaded as `image/png` under a
-- `.jpg`-suffixed key came back `content-type: image/png` on both the direct object GET
-- and a signed URL. So the mismatch was real, not cosmetic; after this migration the
-- declared type and the key extension can no longer disagree.
--
-- Reverses a shipped bucket contract on purpose — exactly the deliberate act 0136's
-- whole-array assertion exists to force; that assertion is updated in this same change.
-- Existing objects are unaffected (staging holds only .jpg/image/jpeg uploads from the
-- client path; the probe object was deleted).
update storage.buckets
set allowed_mime_types = array['image/jpeg']
where id = 'chat-media';
